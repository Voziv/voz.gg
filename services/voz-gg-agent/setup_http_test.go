package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPEnrollSuccess(t *testing.T) {
	var gotPath string
	var gotToken string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		var req map[string]string
		_ = json.Unmarshal(body, &req)
		gotToken = req["enrollmentToken"]

		_ = json.NewEncoder(w).Encode(map[string]any{
			"agentToken": "AT",
			"config": map[string]any{
				"serverId": "srv1", "gameType": "minecraft-java",
				"probeHost": "127.0.0.1", "port": 25565,
				"queryPort": 0, "pollIntervalSeconds": 30,
			},
			"configHash": "H",
			"provisioning": map[string]string{
				"runAsUser":  "voz-gg",
				"runAsGroup": "voz-gg",
			},
		})
	}))
	defer srv.Close()

	resp, err := httpEnroll(srv.URL, "tok")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.AgentToken != "AT" {
		t.Errorf("AgentToken = %q, want %q", resp.AgentToken, "AT")
	}
	if resp.Provisioning.RunAsUser != "voz-gg" {
		t.Errorf("RunAsUser = %q, want %q", resp.Provisioning.RunAsUser, "voz-gg")
	}
	if gotPath != "/api/agents/enroll" {
		t.Errorf("request path = %q, want /api/agents/enroll", gotPath)
	}
	if gotToken != "tok" {
		t.Errorf("enrollmentToken in body = %q, want %q", gotToken, "tok")
	}
}

func TestHTTPEnrollEmptyTokenRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"agentToken": ""})
	}))
	defer srv.Close()

	_, err := httpEnroll(srv.URL, "tok")
	if err == nil {
		t.Fatal("expected error for empty agent token, got nil")
	}
}

func TestHTTPEnrollNon200Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("unauthorized"))
	}))
	defer srv.Close()

	_, err := httpEnroll(srv.URL, "tok")
	if err == nil {
		t.Fatal("expected error for 401 response, got nil")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should include status code 401, got: %v", err)
	}
}
