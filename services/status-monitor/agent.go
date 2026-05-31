package main

import (
	"context"
	"encoding/json"
	"net/http"

	goshared "voz.gg/libs/go-shared"
	"voz.gg/services/status-monitor/prober"
)

// statusReport is the POST /api/status request body.
type statusReport struct {
	Status     string `json:"status"`
	Players    *int   `json:"players,omitempty"`
	MaxPlayers *int   `json:"maxPlayers,omitempty"`
	Version    string `json:"version,omitempty"`
	LatencyMs  *int   `json:"latencyMs,omitempty"`
	ConfigHash string `json:"configHash"`
}

type statusResponse struct {
	ConfigHash string `json:"configHash"`
}

type configResponse struct {
	Config     ServerConfig `json:"config"`
	ConfigHash string       `json:"configHash"`
}

// Agent runs one probe→report→reconcile cycle per tick.
type Agent struct {
	Config      Config
	Client      *http.Client
	ProberForFn func(gameType string) prober.Prober
	ConfigPath  string // when set, persisted config updates are written here
}

func (a *Agent) reporter() goshared.Reporter {
	return goshared.Reporter{Endpoint: a.Config.WorkerBaseURL, Token: a.Config.AgentToken, Client: a.Client}
}

func (a *Agent) RunCycle(ctx context.Context) error {
	srv := a.Config.Server
	p := a.ProberForFn(srv.GameType)
	queryPort := prober.EffectiveQueryPort(srv.GameType, srv.Port, srv.QueryPort)

	st, err := p.Probe(ctx, srv.ProbeHost, srv.Port, queryPort)
	if err != nil {
		// A prober that errors (rather than reporting offline) still must not drop a report.
		st = prober.Status{Status: "offline"}
	}

	report := statusReport{
		Status:     st.Status,
		Players:    st.Players,
		MaxPlayers: st.MaxPlayers,
		Version:    st.Version,
		LatencyMs:  st.LatencyMs,
		ConfigHash: a.Config.ConfigHash,
	}

	var resp statusResponse
	if err := a.reporter().Post("/api/status", report, &resp); err != nil {
		return err
	}

	if resp.ConfigHash != "" && resp.ConfigHash != a.Config.ConfigHash {
		return a.pullConfig(resp.ConfigHash)
	}
	return nil
}

func (a *Agent) pullConfig(expectedHash string) error {
	req, err := http.NewRequest(http.MethodGet, a.Config.WorkerBaseURL+"/api/agents/config", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.Config.AgentToken)
	client := a.Client
	if client == nil {
		client = http.DefaultClient
	}
	httpResp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer httpResp.Body.Close()

	var fresh configResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&fresh); err != nil {
		return err
	}
	a.Config.Server = fresh.Config
	a.Config.ConfigHash = fresh.ConfigHash
	if a.ConfigPath != "" {
		return SaveConfig(a.ConfigPath, a.Config)
	}
	return nil
}
