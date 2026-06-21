package main

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func fakeProvision(resp enrollResponse, err error) provisionFn {
	return func(string, string) (enrollResponse, error) { return resp, err }
}

func baseReprovisionOpts() reprovisionOptions {
	return reprovisionOptions{
		WorkerBaseURL: "https://voz.gg",
		ConfigPath:    "/etc/voz-gg-agent/monitor.json",
		ExecPath:      "/usr/local/bin/voz-gg-agent",
		OpenTTY: func() (io.ReadWriteCloser, error) {
			panic("test must set OpenTTY or NonInteractive for logparse paths")
		},
	}
}

func existingConfig() Config {
	return Config{
		WorkerBaseURL: "https://voz.gg",
		AgentToken:    "AT-existing",
		ConfigHash:    "OLD",
		Server:        ServerConfig{ServerID: "srv1", GameType: "minecraft-java", Port: 1},
	}
}

func reprovisionSave() (func(Config) error, *Config) {
	var saved Config
	return func(c Config) error { saved = c; return nil }, &saved
}

func hasRun(runs [][]string, want ...string) bool {
	for _, r := range runs {
		if len(r) != len(want) {
			continue
		}
		match := true
		for i := range want {
			if r[i] != want[i] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func TestReprovisionRefreshesConfigWithoutRotatingTokenAndRestartsMonitor(t *testing.T) {
	sys := newFakeSystem()
	sys.units[monitorUnitName] = true
	save, saved := reprovisionSave()
	var out, errb bytes.Buffer

	code := runReprovisionWith(baseReprovisionOpts(), existingConfig(), sys, fakeProvision(sampleEnroll(), nil), save, &out, &errb)
	if code != 0 {
		t.Fatalf("exit = %d (stderr=%q)", code, errb.String())
	}
	// The agent token is preserved; only config + hash are refreshed.
	if saved.AgentToken != "AT-existing" {
		t.Fatalf("agent token rotated: got %q, want AT-existing", saved.AgentToken)
	}
	if saved.ConfigHash != "H1" || saved.Server.ServerID != "srv1" {
		t.Fatalf("config not refreshed: %+v", saved)
	}
	if !hasRun(sys.runs, "systemctl", "restart", monitorUnitName) {
		t.Fatalf("monitor not restarted: %v", sys.runs)
	}
	if _, ok := sys.files["/etc/systemd/system/"+logparseUnitName]; ok {
		t.Fatal("logparse unit must not be installed when capability is disabled")
	}
}

func TestReprovisionEnablesLogparseAndRestartsBothUnits(t *testing.T) {
	sys := newFakeSystem()
	sys.units[monitorUnitName] = true
	opts := baseReprovisionOpts()
	opts.NonInteractive = true
	save, _ := reprovisionSave()
	var out, errb bytes.Buffer

	code := runReprovisionWith(opts, existingConfig(), sys, fakeProvision(logparseEnroll("/home/minecraft/logs"), nil), save, &out, &errb)
	if code != 0 {
		t.Fatalf("exit = %d (stderr=%q)", code, errb.String())
	}
	if _, ok := sys.files["/etc/systemd/system/"+logparseUnitName]; !ok {
		t.Fatal("logparse unit not installed")
	}
	if !hasRun(sys.runs, "systemctl", "enable", "--now", logparseUnitName) {
		t.Fatalf("logparse not enabled: %v", sys.runs)
	}
	if !hasRun(sys.runs, "systemctl", "restart", logparseUnitName) {
		t.Fatalf("logparse not restarted: %v", sys.runs)
	}
	if !hasRun(sys.runs, "systemctl", "restart", monitorUnitName) {
		t.Fatalf("monitor not restarted: %v", sys.runs)
	}
}

func TestReprovisionReusesInstalledLogDirWithoutPrompting(t *testing.T) {
	sys := newFakeSystem()
	sys.units[monitorUnitName] = true
	sys.units[logparseUnitName] = true
	// A prior setup baked a custom log dir into the installed unit. The default
	// OpenTTY panics, so reaching the interactive prompt would fail this test.
	sys.files["/etc/systemd/system/"+logparseUnitName] =
		[]byte(renderLogparseUnit("/usr/local/bin/voz-gg-agent", "/etc/voz-gg-agent/monitor.json", "/srv/custom/logs", stateDir, "voz-gg", "voz-gg", "minecraft"))
	save, _ := reprovisionSave()
	var out, errb bytes.Buffer

	// Provisioning carries a different default log path; the installed dir must win.
	code := runReprovisionWith(baseReprovisionOpts(), existingConfig(), sys, fakeProvision(logparseEnroll("/home/minecraft/logs"), nil), save, &out, &errb)
	if code != 0 {
		t.Fatalf("exit = %d (stderr=%q)", code, errb.String())
	}
	unit := string(sys.files["/etc/systemd/system/"+logparseUnitName])
	if !strings.Contains(unit, "-log-dir /srv/custom/logs ") {
		t.Fatalf("reprovision did not reuse installed log dir; unit=%q", unit)
	}
	if !hasRun(sys.runs, "systemctl", "restart", logparseUnitName) {
		t.Fatalf("logparse not restarted: %v", sys.runs)
	}
}

func TestReprovisionDisablesLogparseRemovesUnit(t *testing.T) {
	sys := newFakeSystem()
	sys.units[monitorUnitName] = true
	sys.units[logparseUnitName] = true // previously enabled
	save, _ := reprovisionSave()
	var out, errb bytes.Buffer

	code := runReprovisionWith(baseReprovisionOpts(), existingConfig(), sys, fakeProvision(sampleEnroll(), nil), save, &out, &errb)
	if code != 0 {
		t.Fatalf("exit = %d (stderr=%q)", code, errb.String())
	}
	if !hasRun(sys.runs, "systemctl", "disable", "--now", logparseUnitName) {
		t.Fatalf("logparse not disabled: %v", sys.runs)
	}
	if !contains(sys.removed, "/etc/systemd/system/"+logparseUnitName) {
		t.Fatalf("logparse unit not removed: %v", sys.removed)
	}
	if hasRun(sys.runs, "systemctl", "restart", logparseUnitName) {
		t.Fatalf("logparse should not be restarted when disabled: %v", sys.runs)
	}
}

func TestReprovisionFetchFailureReturns1(t *testing.T) {
	sys := newFakeSystem()
	save, _ := reprovisionSave()
	code := runReprovisionWith(baseReprovisionOpts(), existingConfig(), sys, fakeProvision(enrollResponse{}, errSentinel), save, &bytes.Buffer{}, &bytes.Buffer{})
	if code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
}

func TestReprovisionWithoutSystemdRefreshesConfigOnly(t *testing.T) {
	sys := newFakeSystem()
	sys.systemd = false
	save, saved := reprovisionSave()
	var out bytes.Buffer

	code := runReprovisionWith(baseReprovisionOpts(), existingConfig(), sys, fakeProvision(logparseEnroll("/x"), nil), save, &out, &bytes.Buffer{})
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if saved.ConfigHash != "H1" {
		t.Fatalf("config not refreshed: %+v", saved)
	}
	if len(sys.runs) != 0 {
		t.Fatalf("no systemctl calls expected without systemd: %v", sys.runs)
	}
}
