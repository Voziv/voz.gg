package logparse

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	goshared "voz.gg/libs/go-shared"
)

func newRunner(dir, srvURL, cp string, batchSize int) *Runner {
	return &Runner{
		Source:     NewSource(dir),
		Deliverer:  NewDeliverer(goshared.Reporter{Endpoint: srvURL, Token: "t", Client: http.DefaultClient}, zeroDelayBackoff()),
		Checkpoint: cp,
		BatchSize:  batchSize,
		Location:   time.UTC,
		AnchorDate: time.Date(2026, 6, 14, 0, 0, 0, 0, time.UTC),
	}
}

func TestBackfillParsesAndDelivers(t *testing.T) {
	dir := t.TempDir()
	log := `[10:00:00] [Server thread/INFO]: Done (1.0s)! For help, type "help"
[10:00:05] [User Authenticator/INFO]: UUID of player Steve is f498b235-9a85-4a5e-9f12-f47eb3a73e9b
[10:00:06] [Server thread/INFO]: Steve joined the game
[10:00:30] [Server thread/INFO]: Steve left the game
[10:00:31] [Server thread/INFO]: Stopping the server
`
	if err := os.WriteFile(filepath.Join(dir, "latest.log"), []byte(log), 0o644); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var got []goshared.PresenceEvent
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b goshared.PresenceBatch
		json.NewDecoder(r.Body).Decode(&b)
		mu.Lock()
		got = append(got, b.Events...)
		mu.Unlock()
		json.NewEncoder(w).Encode(goshared.PresenceResult{Accepted: len(b.Events)})
	}))
	defer srv.Close()

	cpPath := filepath.Join(dir, "cp.json")
	r := newRunner(dir, srv.URL, cpPath, 100)
	if err := r.Backfill(); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 4 {
		t.Fatalf("expected 4 events (start, join, leave, stop), got %d: %+v", len(got), got)
	}
	if got[1].Type != "join" || got[1].IdentityKey == nil || *got[1].IdentityKey != "f498b2359a854a5e9f12f47eb3a73e9b" {
		t.Fatalf("join event wrong: %+v", got[1])
	}
	if got[1].IdentityKind == nil || *got[1].IdentityKind != goshared.IdentityMinecraft {
		t.Fatalf("join identityKind must be minecraft: %+v", got[1])
	}
	if got[0].Type != "server_start" || got[0].IdentityKind != nil {
		t.Fatalf("server_start must have nil identity: %+v", got[0])
	}
	cp, _ := LoadCheckpoint(cpPath)
	if cp.Offset == 0 || cp.File != LatestLog {
		t.Fatalf("checkpoint should advance after delivery: %+v", cp)
	}
}

func TestBackfillResumesFromCheckpoint(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "latest.log"),
		[]byte(`[10:00:06] [Server thread/INFO]: Steve joined the game`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(goshared.PresenceResult{Accepted: 1})
	}))
	defer srv.Close()
	cpPath := filepath.Join(dir, "cp.json")
	r := newRunner(dir, srv.URL, cpPath, 100)
	if err := r.Backfill(); err != nil {
		t.Fatal(err)
	}
	cpBefore, _ := LoadCheckpoint(cpPath)
	if err := r.Backfill(); err != nil {
		t.Fatal(err)
	}
	cpAfter, _ := LoadCheckpoint(cpPath)
	if cpAfter.Offset != cpBefore.Offset {
		t.Fatalf("offset moved with no new data: %d -> %d", cpBefore.Offset, cpAfter.Offset)
	}
}

func TestBackfillChunksByBatchSize(t *testing.T) {
	dir := t.TempDir()
	// 5 join lines; BatchSize 2 must produce 3 POSTs (2+2+1) and deliver all 5.
	lines := "[10:00:00] [Server thread/INFO]: Aaa joined the game\n" +
		"[10:00:01] [Server thread/INFO]: Bbb joined the game\n" +
		"[10:00:02] [Server thread/INFO]: Ccc joined the game\n" +
		"[10:00:03] [Server thread/INFO]: Ddd joined the game\n" +
		"[10:00:04] [Server thread/INFO]: Eee joined the game\n"
	if err := os.WriteFile(filepath.Join(dir, "latest.log"), []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	posts := 0
	total := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b goshared.PresenceBatch
		json.NewDecoder(r.Body).Decode(&b)
		mu.Lock()
		posts++
		total += len(b.Events)
		tooBig := len(b.Events) > 2
		mu.Unlock()
		if tooBig {
			t.Errorf("batch exceeded BatchSize: %d events", len(b.Events))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(goshared.PresenceResult{Accepted: len(b.Events)})
	}))
	defer srv.Close()

	r := newRunner(dir, srv.URL, filepath.Join(dir, "cp.json"), 2)
	if err := r.Backfill(); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if total != 5 || posts != 3 {
		t.Fatalf("expected 5 events over 3 posts, got total=%d posts=%d", total, posts)
	}
}

func TestBackfillPropagatesDeliveryError(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "latest.log"),
		[]byte(`[10:00:06] [Server thread/INFO]: Steve joined the game`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable) // always fails; retries exhaust
	}))
	defer srv.Close()

	cpPath := filepath.Join(dir, "cp.json")
	r := newRunner(dir, srv.URL, cpPath, 100)
	if err := r.Backfill(); err == nil {
		t.Fatal("expected Backfill to propagate the delivery failure")
	}
	// Checkpoint must NOT advance when delivery never succeeded.
	if cp, _ := LoadCheckpoint(cpPath); cp.Offset != 0 {
		t.Fatalf("checkpoint advanced despite delivery failure: %+v", cp)
	}
}

func TestBackfillProcessesRolledGzip(t *testing.T) {
	dir := t.TempDir()
	writeGz(t, filepath.Join(dir, "2026-06-13-1.log.gz"),
		"[09:00:00] [Server thread/INFO]: Steve joined the game\n")
	var mu sync.Mutex
	var got []goshared.PresenceEvent
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b goshared.PresenceBatch
		json.NewDecoder(r.Body).Decode(&b)
		mu.Lock()
		got = append(got, b.Events...)
		mu.Unlock()
		json.NewEncoder(w).Encode(goshared.PresenceResult{Accepted: len(b.Events)})
	}))
	defer srv.Close()

	cpPath := filepath.Join(dir, "cp.json")
	r := newRunner(dir, srv.URL, cpPath, 100)
	if err := r.Backfill(); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || got[0].Type != "join" {
		t.Fatalf("expected one join from the rolled log, got %+v", got)
	}
	// A rolled log's date anchors the event to 2026-06-13 (not AnchorDate's day).
	if want := time.Date(2026, 6, 13, 9, 0, 0, 0, time.UTC).Unix(); got[0].OccurredAt != want {
		t.Fatalf("rolled-log event time wrong: got %d want %d", got[0].OccurredAt, want)
	}
	// Rolled logs never write the checkpoint.
	if cp, _ := LoadCheckpoint(cpPath); cp.File != "" {
		t.Fatalf("rolled log must not write a checkpoint: %+v", cp)
	}
}
