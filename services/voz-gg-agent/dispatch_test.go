package main

import (
	"bytes"
	"io"
	"path/filepath"
	"strings"
	"testing"
)

func TestDispatchVersionPrintsVersion(t *testing.T) {
	var out bytes.Buffer
	for _, arg := range []string{"version", "-version", "--version"} {
		out.Reset()
		if code := dispatch([]string{arg}, strings.NewReader(""), &out, io.Discard); code != 0 {
			t.Fatalf("%s exit = %d, want 0", arg, code)
		}
		if got := strings.TrimSpace(out.String()); got != version {
			t.Fatalf("%s printed %q, want %q", arg, got, version)
		}
	}
}

func TestDispatchNoArgsIsUsageError(t *testing.T) {
	if code := dispatch(nil, strings.NewReader(""), io.Discard, io.Discard); code != 2 {
		t.Fatalf("no-args exit = %d, want 2", code)
	}
}

func TestDispatchUnknownCommandIsUsageError(t *testing.T) {
	var errb bytes.Buffer
	if code := dispatch([]string{"bogus"}, strings.NewReader(""), io.Discard, &errb); code != 2 {
		t.Fatalf("unknown exit = %d, want 2", code)
	}
	if !strings.Contains(errb.String(), "unknown command") {
		t.Fatalf("stderr = %q, want it to mention unknown command", errb.String())
	}
}

func TestDispatchLogparseRequiresLogDir(t *testing.T) {
	var errb bytes.Buffer
	if code := dispatch([]string{"logparse"}, strings.NewReader(""), io.Discard, &errb); code != 2 {
		t.Fatalf("logparse exit = %d, want 2", code)
	}
	if !strings.Contains(errb.String(), "log-dir") {
		t.Fatalf("stderr = %q, want it to mention log-dir", errb.String())
	}
}

func TestDispatchHelp(t *testing.T) {
	var out bytes.Buffer
	if code := dispatch([]string{"help"}, strings.NewReader(""), &out, io.Discard); code != 0 {
		t.Fatalf("help exit = %d, want 0", code)
	}
	if !strings.Contains(out.String(), "monitor") {
		t.Fatalf("help output = %q, want it to list commands", out.String())
	}
}

func TestDispatchSubcommandHelpExitsZero(t *testing.T) {
	for _, sub := range []string{"monitor", "write-config"} {
		code := dispatch([]string{sub, "--help"}, strings.NewReader(""), io.Discard, io.Discard)
		if code != 0 {
			t.Errorf("%s --help exit = %d, want 0", sub, code)
		}
	}
}

func TestDispatchSetupRequiresFlags(t *testing.T) {
	var errb bytes.Buffer
	// No flags → missing required --enrollment-token/--worker-base-url → exit 2,
	// and crucially no network/system side effects are attempted.
	if code := dispatch([]string{"setup"}, strings.NewReader(""), io.Discard, &errb); code != 2 {
		t.Fatalf("setup with no flags exit = %d, want 2", code)
	}
	if !strings.Contains(errb.String(), "required") {
		t.Fatalf("stderr = %q, want it to mention required flags", errb.String())
	}
}

func TestDispatchWriteConfigWritesConfig(t *testing.T) {
	enrollJSON := `{"agentToken":"AT","config":{"serverId":"srv1","gameType":"source","probeHost":"127.0.0.1","port":27015,"queryPort":0,"pollIntervalSeconds":30},"configHash":"H1"}`
	configPath := filepath.Join(t.TempDir(), "monitor.json")

	code := dispatch(
		[]string{"write-config", "-worker-base-url", "https://voz.gg", "-config", configPath},
		strings.NewReader(enrollJSON),
		io.Discard,
		io.Discard,
	)
	if code != 0 {
		t.Fatalf("write-config exit = %d, want 0", code)
	}

	cfg, err := LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig after write-config: %v", err)
	}
	if cfg.AgentToken != "AT" || cfg.ConfigHash != "H1" || cfg.WorkerBaseURL != "https://voz.gg" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if cfg.Server.GameType != "source" || cfg.Server.Port != 27015 {
		t.Fatalf("unexpected server config: %+v", cfg.Server)
	}
}
