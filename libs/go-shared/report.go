package goshared

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Reporter posts events to a voz.gg Worker endpoint using a shared bearer token.
type Reporter struct {
	Endpoint string
	Token    string
	Client   *http.Client
}

func (r Reporter) buildRequest(e Event) (*http.Request, error) {
	body, err := json.Marshal(e)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, r.Endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+r.Token)
	return req, nil
}

// httpClient returns a client that never follows redirects. A voz.gg Worker
// endpoint answers a presence/report POST directly; a 3xx means the request hit
// the wrong place (e.g. the web app's auth middleware redirecting an unmatched
// path to /sign-in). Following it would turn that misroute into a misleading 200
// from a login page, so we surface the 3xx as a non-2xx error instead. The base
// client is copied so the caller's client is left untouched.
func (r Reporter) httpClient() *http.Client {
	base := r.Client
	if base == nil {
		base = http.DefaultClient
	}
	client := *base
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &client
}

// Send posts a single Event to the configured Endpoint with the bearer token.
func (r Reporter) Send(e Event) error {
	req, err := r.buildRequest(e)
	if err != nil {
		return err
	}
	resp, err := r.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("report: unexpected status %d", resp.StatusCode)
	}
	return nil
}

// Post sends payload as JSON to Endpoint+path with the bearer token and, when
// out is non-nil, decodes the JSON response into it.
func (r Reporter) Post(path string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, r.Endpoint+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+r.Token)

	resp, err := r.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("post %s: status %d: %s", path, resp.StatusCode, string(b))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
