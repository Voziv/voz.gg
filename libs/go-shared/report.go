package goshared

import (
	"bytes"
	"encoding/json"
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
