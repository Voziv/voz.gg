package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

// TestVersionFlagPrintsLdflagVersion builds the binary with an injected
// version and asserts the --version flag prints exactly that value.
func TestVersionFlagPrintsLdflagVersion(t *testing.T) {
	bin := t.TempDir() + "/status-monitor"
	build := exec.Command("go", "build",
		"-ldflags", "-X main.version=9.9.9-test",
		"-o", bin, ".")
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		t.Fatalf("build failed: %v", err)
	}

	out, err := exec.Command(bin, "--version").CombinedOutput()
	if err != nil {
		t.Fatalf("run --version failed: %v (output: %s)", err, out)
	}
	if got := strings.TrimSpace(string(out)); got != "9.9.9-test" {
		t.Fatalf("--version printed %q, want %q", got, "9.9.9-test")
	}
}
