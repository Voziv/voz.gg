package main

import "testing"

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
