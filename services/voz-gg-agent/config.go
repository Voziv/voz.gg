package main

import (
	"encoding/json"
	"os"
)

// ServerConfig mirrors the Worker's AgentConfig shape. The agent treats the
// surrounding ConfigHash as opaque and never recomputes it.
type ServerConfig struct {
	ServerID            string `json:"serverId"`
	GameType            string `json:"gameType"`
	ProbeHost           string `json:"probeHost"`
	Port                int    `json:"port"`
	QueryPort           int    `json:"queryPort"`
	PollIntervalSeconds int    `json:"pollIntervalSeconds"`
}

type Config struct {
	WorkerBaseURL string       `json:"workerBaseUrl"`
	AgentToken    string       `json:"agentToken"`
	ConfigHash    string       `json:"configHash"`
	Server        ServerConfig `json:"config"`
}

func LoadConfig(path string) (Config, error) {
	var cfg Config
	raw, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func SaveConfig(path string, cfg Config) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

// enrollResponse is the POST /api/agents/enroll response shape, decoded by setup.
type enrollResponse struct {
	AgentToken   string       `json:"agentToken"`
	Config       ServerConfig `json:"config"`
	ConfigHash   string       `json:"configHash"`
	Provisioning provisioning `json:"provisioning"`
}
