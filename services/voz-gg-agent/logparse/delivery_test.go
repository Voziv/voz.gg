package logparse

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	goshared "voz.gg/libs/go-shared"
)

// zeroDelayBackoff returns a no-sleep backoff capped at 3 attempts for fast tests.
func zeroDelayBackoff() Backoff { return Backoff{Base: 0, Max: 0, MaxAttempts: 3} }

func TestDeliverPostsBatchAndSucceeds(t *testing.T) {
	var gotPath, gotAuth string
	var body goshared.PresenceBatch
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		json.NewDecoder(r.Body).Decode(&body)
		json.NewEncoder(w).Encode(goshared.PresenceResult{Accepted: 1})
	}))
	defer srv.Close()

	rep := goshared.Reporter{Endpoint: srv.URL, Token: "tok", Client: srv.Client()}
	d := NewDeliverer(rep, zeroDelayBackoff())
	if err := d.Deliver([]goshared.PresenceEvent{{Type: "join", OccurredAt: 1}}); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/presence" || gotAuth != "Bearer tok" || len(body.Events) != 1 {
		t.Fatalf("path=%s auth=%s events=%d", gotPath, gotAuth, len(body.Events))
	}
}

func TestDeliverRetriesOn5xxThenSucceeds(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls < 3 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		json.NewEncoder(w).Encode(goshared.PresenceResult{Accepted: 1})
	}))
	defer srv.Close()

	rep := goshared.Reporter{Endpoint: srv.URL, Token: "tok", Client: srv.Client()}
	d := NewDeliverer(rep, zeroDelayBackoff())
	if err := d.Deliver([]goshared.PresenceEvent{{Type: "join", OccurredAt: 1}}); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("expected 3 attempts, got %d", calls)
	}
}

func TestDeliverDoesNotRetry4xx(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	rep := goshared.Reporter{Endpoint: srv.URL, Token: "tok", Client: srv.Client()}
	d := NewDeliverer(rep, zeroDelayBackoff())
	if err := d.Deliver([]goshared.PresenceEvent{{Type: "join", OccurredAt: 1}}); err == nil {
		t.Fatal("expected permanent error on 4xx")
	}
	if calls != 1 {
		t.Fatalf("4xx must not retry, got %d calls", calls)
	}
}

// Pins the Reporter's non-2xx error format so isPermanent's status-string match
// can't silently break if go-shared changes its error wording.
func TestReporterErrorFormatIsStable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	rep := goshared.Reporter{Endpoint: srv.URL, Token: "t", Client: srv.Client()}
	err := rep.Post("/presence", goshared.PresenceBatch{}, nil)
	if err == nil || !isPermanent(err) {
		t.Fatalf("isPermanent must recognize a 4xx from the Reporter: %v", err)
	}
}

func TestDeliverRetries5xxWhoseBodyMentionsA4xx(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls < 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			// Body text mentions "status 400" but this is a retryable 5xx, not permanent.
			w.Write([]byte("upstream returned status 400 earlier; retry later"))
			return
		}
		json.NewEncoder(w).Encode(goshared.PresenceResult{Accepted: 1})
	}))
	defer srv.Close()

	rep := goshared.Reporter{Endpoint: srv.URL, Token: "tok", Client: srv.Client()}
	d := NewDeliverer(rep, zeroDelayBackoff())
	if err := d.Deliver([]goshared.PresenceEvent{{Type: "join", OccurredAt: 1}}); err != nil {
		t.Fatalf("a 5xx whose body mentions a 4xx must be retried, not treated as permanent: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected a retry then success, got %d calls", calls)
	}
}

func TestDeliverGivesUpAfterMaxAttempts(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	rep := goshared.Reporter{Endpoint: srv.URL, Token: "tok", Client: srv.Client()}
	d := NewDeliverer(rep, zeroDelayBackoff()) // MaxAttempts: 3
	if err := d.Deliver([]goshared.PresenceEvent{{Type: "join", OccurredAt: 1}}); err == nil {
		t.Fatal("expected an error after exhausting retries")
	}
	if calls != 3 {
		t.Fatalf("expected exactly MaxAttempts (3) calls, got %d", calls)
	}
}

func TestBackoffDelayCapsAndDoesNotOverflow(t *testing.T) {
	b := Backoff{Base: time.Second, Max: 30 * time.Second}
	// A large attempt count must never wrap to a negative duration; it must stay
	// pinned at Max.
	for _, attempt := range []int{0, 5, 34, 100, 1000} {
		if d := b.delay(attempt); d < 0 || d > b.Max {
			t.Fatalf("attempt %d: delay %v out of [0, %v]", attempt, d, b.Max)
		}
	}
	if d := b.delay(100); d != b.Max {
		t.Fatalf("large attempt should pin to Max, got %v", d)
	}
}
