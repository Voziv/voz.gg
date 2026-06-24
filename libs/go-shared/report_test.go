package goshared

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPostSendsBearerAndDecodesResponse(t *testing.T) {
	type reqBody struct {
		Name string `json:"name"`
	}
	type respBody struct {
		Echo string `json:"echo"`
	}

	var gotAuth, gotContentType, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotContentType = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_ = json.NewEncoder(w).Encode(respBody{Echo: "ok"})
	}))
	defer srv.Close()

	r := Reporter{Endpoint: srv.URL, Token: "tok123", Client: srv.Client()}
	var out respBody
	if err := r.Post("/echo", reqBody{Name: "alice"}, &out); err != nil {
		t.Fatalf("Post returned error: %v", err)
	}

	if gotAuth != "Bearer tok123" {
		t.Fatalf("auth header = %q", gotAuth)
	}
	if gotContentType != "application/json" {
		t.Fatalf("content-type = %q", gotContentType)
	}
	if gotBody != `{"name":"alice"}` && gotBody != "{\"name\":\"alice\"}\n" {
		t.Fatalf("body = %q", gotBody)
	}
	if out.Echo != "ok" {
		t.Fatalf("decoded echo = %q", out.Echo)
	}
}

func TestPostNonOKStatusIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	r := Reporter{Endpoint: srv.URL, Token: "bad", Client: srv.Client()}
	if err := r.Post("/x", map[string]string{}, nil); err == nil {
		t.Fatal("expected error on 401, got nil")
	}
}

// A 3xx must surface as an error rather than being followed. Following a redirect
// (the default http.Client behavior) would let a misrouted POST land on the web
// app's /sign-in page, return 200, and be mistaken for a successful delivery.
func TestPostDoesNotFollowRedirects(t *testing.T) {
	followed := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/sign-in" {
			followed = true
			_ = json.NewEncoder(w).Encode(map[string]string{"page": "sign-in"})
			return
		}
		http.Redirect(w, r, "/sign-in", http.StatusFound)
	}))
	defer srv.Close()

	r := Reporter{Endpoint: srv.URL, Token: "tok", Client: srv.Client()}
	if err := r.Post("/presence", map[string]string{}, nil); err == nil {
		t.Fatal("expected error on 302, got nil")
	}
	if followed {
		t.Fatal("redirect was followed; the 3xx must surface as an error instead")
	}
}
