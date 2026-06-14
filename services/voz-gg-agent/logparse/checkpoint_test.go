package logparse

import (
	"path/filepath"
	"testing"
)

func TestCheckpointRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cp.json")
	if err := SaveCheckpoint(path, Checkpoint{File: "latest.log", Offset: 4096}); err != nil {
		t.Fatal(err)
	}
	got, err := LoadCheckpoint(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.File != "latest.log" || got.Offset != 4096 {
		t.Fatalf("got %+v", got)
	}
}

func TestLoadMissingCheckpointIsZero(t *testing.T) {
	got, err := LoadCheckpoint(filepath.Join(t.TempDir(), "absent.json"))
	if err != nil {
		t.Fatalf("missing checkpoint must not error: %v", err)
	}
	if got.File != "" || got.Offset != 0 {
		t.Fatalf("expected zero checkpoint, got %+v", got)
	}
}
