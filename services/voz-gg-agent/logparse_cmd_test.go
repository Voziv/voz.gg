package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestLogparseRequiresLogDir(t *testing.T) {
	var stderr bytes.Buffer
	code := runLogparse([]string{"-config", "/nonexistent.json"}, &stderr)
	if code == 0 {
		t.Fatal("expected non-zero exit without -log-dir")
	}
	if !strings.Contains(stderr.String(), "log-dir") {
		t.Fatalf("expected log-dir error, got %q", stderr.String())
	}
}

func TestLogparseReportsConfigLoadError(t *testing.T) {
	var stderr bytes.Buffer
	code := runLogparse([]string{"-config", "/nonexistent.json", "-log-dir", "/tmp", "-backfill-only"}, &stderr)
	if code == 0 || !strings.Contains(stderr.String(), "config") {
		t.Fatalf("expected config load error, got code=%d %q", code, stderr.String())
	}
}
