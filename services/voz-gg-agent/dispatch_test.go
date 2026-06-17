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
