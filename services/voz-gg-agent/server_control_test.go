package main

import (
	"strings"
	"testing"
)

func TestEnsureRconPasswordMintsOnce(t *testing.T) {
	cfg := &Config{}
	sc := serverControlCapability{Enabled: true, RconPort: 25575}

	changed, err := ensureRconPassword(cfg, sc)
	if err != nil {
		t.Fatalf("ensureRconPassword: %v", err)
	}
	if !changed {
		t.Fatal("first call should report changed")
	}
	if cfg.RCON.Password == "" {
		t.Fatal("password not minted")
	}
	if cfg.RCON.Port != 25575 {
		t.Fatalf("port = %d, want 25575", cfg.RCON.Port)
	}

	first := cfg.RCON.Password
	changed, err = ensureRconPassword(cfg, sc)
	if err != nil {
		t.Fatalf("ensureRconPassword #2: %v", err)
	}
	if changed {
		t.Fatal("second call should not report changed")
	}
	if cfg.RCON.Password != first {
		t.Fatal("password rotated; must be mint-once")
	}
}

func TestEnsureRconPasswordDisabledNoop(t *testing.T) {
	cfg := &Config{}
	changed, err := ensureRconPassword(cfg, serverControlCapability{Enabled: false})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if changed || cfg.RCON.Password != "" {
		t.Fatal("disabled capability must not mint a password")
	}
}

func TestEnsureRconPasswordDefaultsPort(t *testing.T) {
	cfg := &Config{}
	if _, err := ensureRconPassword(cfg, serverControlCapability{Enabled: true}); err != nil {
		t.Fatalf("err: %v", err)
	}
	if cfg.RCON.Port != defaultRconPort {
		t.Fatalf("port = %d, want %d", cfg.RCON.Port, defaultRconPort)
	}
}

func TestSetPropertiesUpdatesAndPreserves(t *testing.T) {
	in := "# header\nmotd=Hello World\nenable-rcon=false\nmax-players=20\n"
	out := setProperties(in, map[string]string{
		"enable-rcon":   "true",
		"rcon.port":     "25575",
		"rcon.password": "s3cret",
	})
	// Untouched keys stay byte-stable, in place.
	if !strings.Contains(out, "# header\n") || !strings.Contains(out, "motd=Hello World\n") || !strings.Contains(out, "max-players=20\n") {
		t.Fatalf("unrelated lines not preserved:\n%s", out)
	}
	// Existing key updated in place (not appended).
	if !strings.Contains(out, "enable-rcon=true") || strings.Contains(out, "enable-rcon=false") {
		t.Fatalf("enable-rcon not updated in place:\n%s", out)
	}
	// Missing keys appended.
	if !strings.Contains(out, "rcon.port=25575\n") || !strings.Contains(out, "rcon.password=s3cret\n") {
		t.Fatalf("missing keys not appended:\n%s", out)
	}
}

func TestSetPropertiesNoChangeIsByteStable(t *testing.T) {
	in := "enable-rcon=true\nrcon.port=25575\n"
	out := setProperties(in, map[string]string{"enable-rcon": "true", "rcon.port": "25575"})
	if out != in {
		t.Fatalf("expected byte-stable output, got:\n%q", out)
	}
}

func TestReadProperty(t *testing.T) {
	in := "# c\nrcon.password=abc123\nrcon.port=12345\n"
	if got := readProperty(in, "rcon.password"); got != "abc123" {
		t.Fatalf("password = %q", got)
	}
	if got := readProperty(in, "rcon.port"); got != "12345" {
		t.Fatalf("port = %q", got)
	}
	if got := readProperty(in, "absent"); got != "" {
		t.Fatalf("absent = %q, want empty", got)
	}
}
