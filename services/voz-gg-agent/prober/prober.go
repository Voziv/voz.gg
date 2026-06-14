// Package prober probes game servers for liveness and player counts.
package prober

import "context"

type Status struct {
	Status     string `json:"status"` // "online" | "offline" | "unknown"
	Players    *int   `json:"players,omitempty"`
	MaxPlayers *int   `json:"maxPlayers,omitempty"`
	Version    string `json:"version,omitempty"`
	LatencyMs  *int   `json:"latencyMs,omitempty"`
}

type Prober interface {
	Probe(ctx context.Context, host string, port, queryPort int) (Status, error)
}

func intPtr(v int) *int { return &v }
