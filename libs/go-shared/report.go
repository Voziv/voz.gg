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

func (r Reporter) httpClient() *http.Client {
	if r.Client != nil {
		return r.Client
	}
	return http.DefaultClient
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
