package main

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRconCredsFromProperties(t *testing.T) {
	dir := t.TempDir()
	props := filepath.Join(dir, "server.properties")
	if err := os.WriteFile(props, []byte("rcon.password=abc\nrcon.port=12345\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	pw, port, err := resolveRconCreds("", props)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if pw != "abc" || port != 12345 {
		t.Fatalf("got %q/%d", pw, port)
	}
}

func TestResolveRconCredsFromConfig(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "monitor.json")
	if err := SaveConfig(cfgPath, Config{RCON: rconConfig{Password: "xyz", Port: 25575}}); err != nil {
		t.Fatal(err)
	}
	pw, port, err := resolveRconCreds(cfgPath, "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if pw != "xyz" || port != 25575 {
		t.Fatalf("got %q/%d", pw, port)
	}
}

func TestResolveRconCredsMissingPasswordErrors(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "monitor.json")
	if err := SaveConfig(cfgPath, Config{}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := resolveRconCreds(cfgPath, ""); err == nil {
		t.Fatal("expected error when no rcon password configured")
	}
}

func TestRunRconMissingCredsExitsNonZero(t *testing.T) {
	// No config file present: should fail cleanly, not panic.
	if code := runRcon([]string{"-config", "/nonexistent/monitor.json", "list"}, io.Discard, io.Discard); code == 0 {
		t.Fatal("expected non-zero exit with missing config")
	}
}
