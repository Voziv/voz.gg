package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"voz.gg/services/voz-gg-agent/prober"
)

type fakeProber struct{ st prober.Status }

func (f fakeProber) Probe(ctx context.Context, host string, port, queryPort int) (prober.Status, error) {
	return f.st, nil
}

func TestRunCyclePostsStatusAndPullsConfigOnMismatch(t *testing.T) {
	var statusBody map[string]any
	configPulled := false

	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer AT" {
			t.Errorf("auth = %q", got)
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &statusBody)
		_ = json.NewEncoder(w).Encode(map[string]string{"configHash": "NEW"})
	})
	mux.HandleFunc("/api/agents/config", func(w http.ResponseWriter, r *http.Request) {
		configPulled = true
		_ = json.NewEncoder(w).Encode(map[string]any{
			"config": map[string]any{
				"serverId": "srv1", "gameType": "minecraft-java", "probeHost": "127.0.0.1",
				"port": 25566, "queryPort": 0, "pollIntervalSeconds": 30,
			},
			"configHash": "NEW",
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	online := 9
	max := 20
	agent := &Agent{
		Config: Config{
			WorkerBaseURL: srv.URL,
			AgentToken:    "AT",
			ConfigHash:    "OLD",
			Server:        ServerConfig{ServerID: "srv1", GameType: "minecraft-java", ProbeHost: "127.0.0.1", Port: 25565, PollIntervalSeconds: 30},
		},
		Client: srv.Client(),
		ProberForFn: func(string) prober.Prober {
			return fakeProber{st: prober.Status{Status: "online", Players: &online, MaxPlayers: &max, Version: "1.21"}}
		},
	}

	if err := agent.RunCycle(context.Background()); err != nil {
		t.Fatalf("RunCycle: %v", err)
	}

	if statusBody["status"] != "online" {
		t.Fatalf("status posted = %v", statusBody["status"])
	}
	if statusBody["players"].(float64) != 9 || statusBody["maxPlayers"].(float64) != 20 {
		t.Fatalf("counts posted = %v/%v", statusBody["players"], statusBody["maxPlayers"])
	}
	if statusBody["configHash"] != "OLD" {
		t.Fatalf("agent should post its cached hash, got %v", statusBody["configHash"])
	}
	if !configPulled {
		t.Fatal("config should have been pulled on hash mismatch")
	}
	if agent.Config.ConfigHash != "NEW" || agent.Config.Server.Port != 25566 {
		t.Fatalf("agent config not updated: hash=%s port=%d", agent.Config.ConfigHash, agent.Config.Server.Port)
	}
}

func TestRunCycleNoPullWhenHashMatches(t *testing.T) {
	configPulled := false
	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"configHash": "SAME"})
	})
	mux.HandleFunc("/api/agents/config", func(w http.ResponseWriter, r *http.Request) {
		configPulled = true
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	agent := &Agent{
		Config:      Config{WorkerBaseURL: srv.URL, AgentToken: "AT", ConfigHash: "SAME", Server: ServerConfig{ServerID: "srv1", GameType: "generic-tcp", Port: 7777, PollIntervalSeconds: 30}},
		Client:      srv.Client(),
		ProberForFn: func(string) prober.Prober { return fakeProber{st: prober.Status{Status: "offline"}} },
	}
	if err := agent.RunCycle(context.Background()); err != nil {
		t.Fatalf("RunCycle: %v", err)
	}
	if configPulled {
		t.Fatal("config should NOT be pulled when hash matches")
	}
}
