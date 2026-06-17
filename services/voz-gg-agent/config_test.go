package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func sampleConfig() Config {
	return Config{
		WorkerBaseURL: "https://voz.gg",
		AgentToken:    "agent-tok",
		ConfigHash:    "abc123",
		Server: ServerConfig{
			ServerID:            "srv1",
			GameType:            "minecraft-java",
			ProbeHost:           "127.0.0.1",
			Port:                25565,
			QueryPort:           0,
			PollIntervalSeconds: 30,
		},
	}
}

func TestSaveThenLoadRoundTrips(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	want := sampleConfig()
	if err := SaveConfig(path, want); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	got, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if got != want {
		t.Fatalf("round-trip mismatch:\n got %+v\nwant %+v", got, want)
	}
}

func TestLoadMissingFileErrors(t *testing.T) {
	if _, err := LoadConfig(filepath.Join(t.TempDir(), "nope.json")); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestSaveWritesIndentedJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := SaveConfig(path, sampleConfig()); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	raw, _ := os.ReadFile(path)
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		t.Fatalf("written file is not valid JSON: %v", err)
	}
	if _, ok := probe["workerBaseUrl"]; !ok {
		t.Fatalf("expected workerBaseUrl key, got %s", raw)
	}
}
