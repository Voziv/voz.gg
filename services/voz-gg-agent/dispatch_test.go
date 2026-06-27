package main

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestDispatchVersionPrintsVersion(t *testing.T) {
	var out bytes.Buffer
	for _, arg := range []string{"version", "-version", "--version"} {
		out.Reset()
		if code := dispatch([]string{arg}, &out, io.Discard); code != 0 {
			t.Fatalf("%s exit = %d, want 0", arg, code)
		}
		if got := strings.TrimSpace(out.String()); got != version {
			t.Fatalf("%s printed %q, want %q", arg, got, version)
		}
	}
}

func TestDispatchNoArgsIsUsageError(t *testing.T) {
	if code := dispatch(nil, io.Discard, io.Discard); code != 2 {
		t.Fatalf("no-args exit = %d, want 2", code)
	}
}

func TestDispatchUnknownCommandIsUsageError(t *testing.T) {
	var errb bytes.Buffer
	if code := dispatch([]string{"bogus"}, io.Discard, &errb); code != 2 {
		t.Fatalf("unknown exit = %d, want 2", code)
	}
	if !strings.Contains(errb.String(), "unknown command") {
		t.Fatalf("stderr = %q, want it to mention unknown command", errb.String())
	}
}

func TestDispatchLogparseRequiresLogDir(t *testing.T) {
	var errb bytes.Buffer
	if code := dispatch([]string{"logparse"}, io.Discard, &errb); code != 2 {
		t.Fatalf("logparse exit = %d, want 2", code)
	}
	if !strings.Contains(errb.String(), "log-dir") {
		t.Fatalf("stderr = %q, want it to mention log-dir", errb.String())
	}
}

func TestDispatchHelp(t *testing.T) {
	var out bytes.Buffer
	if code := dispatch([]string{"help"}, &out, io.Discard); code != 0 {
		t.Fatalf("help exit = %d, want 0", code)
	}
	if !strings.Contains(out.String(), "monitor") {
		t.Fatalf("help output = %q, want it to list commands", out.String())
	}
}

func TestDispatchSubcommandHelpExitsZero(t *testing.T) {
	if code := dispatch([]string{"monitor", "--help"}, io.Discard, io.Discard); code != 0 {
		t.Errorf("monitor --help exit = %d, want 0", code)
	}
}

func TestDispatchUpdatesHelpExitsZero(t *testing.T) {
	if code := dispatch([]string{"updates", "--help"}, io.Discard, io.Discard); code != 0 {
		t.Errorf("updates --help exit = %d, want 0", code)
	}
}

func TestDispatchUpdatesMissingConfigFails(t *testing.T) {
	var errb bytes.Buffer
	if code := dispatch([]string{"updates", "--reconcile-once", "-config", "/nonexistent/voz-gg-agent.json"}, io.Discard, &errb); code != 1 {
		t.Fatalf("updates with missing config exit = %d, want 1", code)
	}
	if !strings.Contains(errb.String(), "load config") {
		t.Fatalf("stderr = %q, want it to mention load config", errb.String())
	}
}

func TestDispatchReprovisionMissingConfigFails(t *testing.T) {
	var errb bytes.Buffer
	// A nonexistent config can't be loaded → exit 1, no network attempted.
	if code := dispatch([]string{"reprovision", "-config", "/nonexistent/voz-gg-agent.json"}, io.Discard, &errb); code != 1 {
		t.Fatalf("reprovision with missing config exit = %d, want 1", code)
	}
	if !strings.Contains(errb.String(), "load config") {
		t.Fatalf("stderr = %q, want it to mention load config", errb.String())
	}
}

func TestDispatchUpdateRejectsUnknownFlag(t *testing.T) {
	// An unknown flag must fail at parse time (exit 2) before any download is
	// attempted, so the test never touches the network.
	if code := dispatch([]string{"update", "--bogus"}, io.Discard, io.Discard); code != 2 {
		t.Fatalf("update with unknown flag exit = %d, want 2", code)
	}
}

func TestDispatchRconMissingCredsIsError(t *testing.T) {
	var errb bytes.Buffer
	code := dispatch([]string{"rcon", "-config", "/nonexistent/monitor.json", "list"}, io.Discard, &errb)
	if code == 0 {
		t.Fatalf("rcon exit = %d, want non-zero", code)
	}
	if !strings.Contains(errb.String(), "rcon:") {
		t.Fatalf("stderr = %q, want an rcon error", errb.String())
	}
}

func TestDispatchSetupRequiresFlags(t *testing.T) {
	var errb bytes.Buffer
	// No flags → missing required --enrollment-token/--worker-base-url → exit 2,
	// and crucially no network/system side effects are attempted.
	if code := dispatch([]string{"setup"}, io.Discard, &errb); code != 2 {
		t.Fatalf("setup with no flags exit = %d, want 2", code)
	}
	if !strings.Contains(errb.String(), "required") {
		t.Fatalf("stderr = %q, want it to mention required flags", errb.String())
	}
}
