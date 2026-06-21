package main

import (
	"bytes"
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

func TestSanitizeSlug(t *testing.T) {
	cases := map[string]string{
		"Survival":     "survival",
		"My Server_01": "my-server-01",
		"  trim-me  ":  "trim-me",
		"a/b!c":        "abc",
	}
	for in, want := range cases {
		got, err := sanitizeSlug(in)
		if err != nil {
			t.Fatalf("sanitizeSlug(%q): %v", in, err)
		}
		if got != want {
			t.Fatalf("sanitizeSlug(%q) = %q, want %q", in, got, want)
		}
	}
	if _, err := sanitizeSlug("!!!"); err == nil {
		t.Fatal("expected error for slug that sanitizes to empty")
	}
}

func TestValidateSchedule(t *testing.T) {
	if _, err := validateSchedule("08:00"); err != nil {
		t.Fatalf("08:00: %v", err)
	}
	if _, err := validateSchedule("23:59"); err != nil {
		t.Fatalf("23:59: %v", err)
	}
	for _, bad := range []string{"24:00", "8:00", "08:60", "0800", "noon"} {
		if _, err := validateSchedule(bad); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

func TestRenderServerControlUnit(t *testing.T) {
	u := renderServerControlUnit("/usr/local/bin/voz-gg-agent", "survival", "minecraft", "/home/minecraft/server", "./run.sh nogui", "/etc/voz-gg-agent/monitor.json")
	for _, want := range []string{
		"Description=voz.gg game server (survival)",
		"User=minecraft",
		"WorkingDirectory=/home/minecraft/server",
		"ExecStart=./run.sh nogui",
		"ExecStop=-/usr/local/bin/voz-gg-agent rcon --properties /home/minecraft/server/server.properties save-all",
		"ExecStop=-/usr/local/bin/voz-gg-agent rcon --properties /home/minecraft/server/server.properties stop",
		"TimeoutStopSec=120",
		"Restart=on-failure",
		"NoNewPrivileges=true",
	} {
		if !strings.Contains(u, want) {
			t.Fatalf("unit missing %q:\n%s", want, u)
		}
	}
}

func TestRenderRestartServiceAndTimer(t *testing.T) {
	svc := renderRestartService("/usr/local/bin/voz-gg-agent", "survival", "/etc/voz-gg-agent/monitor.json")
	for _, want := range []string{
		"ExecStart=-/usr/local/bin/voz-gg-agent rcon -config /etc/voz-gg-agent/monitor.json \"say Server restarting in 60 seconds\"",
		"ExecStart=/bin/sleep 50",
		"ExecStart=/usr/bin/systemctl restart voz-gg-survival.service",
	} {
		if !strings.Contains(svc, want) {
			t.Fatalf("restart service missing %q:\n%s", want, svc)
		}
	}
	tmr := renderRestartTimer("survival", "08:00")
	if !strings.Contains(tmr, "OnCalendar=*-*-* 08:00:00 UTC") || !strings.Contains(tmr, "Persistent=true") {
		t.Fatalf("timer wrong:\n%s", tmr)
	}
}

func TestReconcileServerControlInstalls(t *testing.T) {
	f := newFakeSystem()
	props := "/home/minecraft/server/server.properties"
	f.paths[props] = true
	f.files[props] = []byte("motd=Hi\nenable-rcon=false\n")
	sc := serverControlCapability{
		Enabled: true, Slug: "survival", ServerUser: "minecraft",
		WorkingDir: "/home/minecraft/server", StartCommand: "./run.sh nogui",
		RestartSchedule: "08:00", RconPort: 25575,
	}
	var out bytes.Buffer
	if err := reconcileServerControl(f, sc, "s3cret", 25575, "/usr/local/bin/voz-gg-agent", "/etc/voz-gg-agent/monitor.json", &out); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	got := string(f.files[props])
	if !strings.Contains(got, "enable-rcon=true") || !strings.Contains(got, "rcon.password=s3cret") || !strings.Contains(got, "motd=Hi") {
		t.Fatalf("server.properties wrong:\n%s", got)
	}
	if _, ok := f.files["/etc/systemd/system/voz-gg-survival.service"]; !ok {
		t.Fatal("gameserver unit not written")
	}
	if _, ok := f.files["/etc/systemd/system/voz-gg-survival-restart.timer"]; !ok {
		t.Fatal("restart timer not written")
	}
}

func TestReconcileServerControlNoScheduleSkipsTimer(t *testing.T) {
	f := newFakeSystem()
	sc := serverControlCapability{
		Enabled: true, Slug: "survival", ServerUser: "minecraft",
		WorkingDir: "/srv/mc", StartCommand: "./run.sh", RestartSchedule: "",
	}
	if err := reconcileServerControl(f, sc, "pw", 25575, "/bin/agent", "/cfg", &bytes.Buffer{}); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if _, ok := f.files["/etc/systemd/system/voz-gg-survival-restart.timer"]; ok {
		t.Fatal("timer should not be installed without a schedule")
	}
}

func TestReconcileServerControlDisabledRemoves(t *testing.T) {
	f := newFakeSystem()
	f.units["voz-gg-survival.service"] = true
	f.units["voz-gg-survival-restart.timer"] = true
	sc := serverControlCapability{Enabled: false, Slug: "survival"}
	if err := reconcileServerControl(f, sc, "", 0, "/bin/agent", "/cfg", &bytes.Buffer{}); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	removed := strings.Join(f.removed, " ")
	if !strings.Contains(removed, "/etc/systemd/system/voz-gg-survival.service") {
		t.Fatalf("disabled capability should remove the unit; removed=%v", f.removed)
	}
}
