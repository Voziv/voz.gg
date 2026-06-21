package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"strings"
	"testing"
)

// errSentinel is a stand-in error for the enroll-failure test.
var errSentinel = errors.New("sentinel")

// fakeSystem records every privileged operation so tests can assert the
// sequence and arguments without touching the real host.
type fakeSystem struct {
	systemd       bool
	groups, users map[string]bool
	createdGroups []string
	createdUsers  []string // "user:group"
	files         map[string][]byte
	filePerms     map[string]uint32
	chowns        []string // "path user:group"
	runs          [][]string
	units         map[string]bool
	paths         map[string]bool
	removed       []string

	downloadedVersion string // returned by binaryVersion
	versionErr        error
	reExeced          bool
	reExecArgs        []string
	reExecErr         error
}

func newFakeSystem() *fakeSystem {
	return &fakeSystem{
		systemd: true,
		groups:  map[string]bool{}, users: map[string]bool{},
		files: map[string][]byte{}, filePerms: map[string]uint32{},
		units: map[string]bool{}, paths: map[string]bool{},
	}
}

func (f *fakeSystem) hasSystemd() bool          { return f.systemd }
func (f *fakeSystem) groupExists(n string) bool { return f.groups[n] }
func (f *fakeSystem) userExists(n string) bool  { return f.users[n] }
func (f *fakeSystem) createSystemGroup(n string) error {
	f.createdGroups = append(f.createdGroups, n)
	f.groups[n] = true
	return nil
}
func (f *fakeSystem) createSystemUser(n, g string) error {
	f.createdUsers = append(f.createdUsers, n+":"+g)
	f.users[n] = true
	return nil
}
func (f *fakeSystem) mkdirAll(string, uint32) error { return nil }
func (f *fakeSystem) writeFile(p string, d []byte, perm uint32) error {
	f.files[p] = d
	f.filePerms[p] = perm
	return nil
}
func (f *fakeSystem) readFile(p string) ([]byte, error) {
	d, ok := f.files[p]
	if !ok {
		return nil, errors.New("readFile: missing " + p)
	}
	return d, nil
}
func (f *fakeSystem) chownRecursive(p, u, g string) error {
	f.chowns = append(f.chowns, p+" "+u+":"+g)
	return nil
}
func (f *fakeSystem) run(name string, args ...string) error {
	f.runs = append(f.runs, append([]string{name}, args...))
	return nil
}
func (f *fakeSystem) unitInstalled(n string) bool { return f.units[n] }
func (f *fakeSystem) pathExists(p string) bool    { return f.paths[p] }
func (f *fakeSystem) remove(p string) error {
	f.removed = append(f.removed, p)
	delete(f.files, p)
	delete(f.filePerms, p)
	return nil
}
func (f *fakeSystem) rename(oldPath, newPath string) error {
	data, ok := f.files[oldPath]
	if !ok {
		return errors.New("rename: missing " + oldPath)
	}
	f.files[newPath] = data
	f.filePerms[newPath] = f.filePerms[oldPath]
	delete(f.files, oldPath)
	delete(f.filePerms, oldPath)
	return nil
}
func (f *fakeSystem) binaryVersion(string) (string, error) {
	return f.downloadedVersion, f.versionErr
}
func (f *fakeSystem) reExec(path string, args []string) error {
	f.reExeced = true
	f.reExecArgs = args
	return f.reExecErr
}

func fakeEnroll(resp enrollResponse, err error) enrollFn {
	return func(string, string) (enrollResponse, error) { return resp, err }
}

func sampleEnroll() enrollResponse {
	return enrollResponse{
		AgentToken:   "AT",
		ConfigHash:   "H1",
		Config:       ServerConfig{ServerID: "srv1", GameType: "minecraft-java", ProbeHost: "127.0.0.1", Port: 25565, PollIntervalSeconds: 30},
		Provisioning: provisioning{RunAsUser: "voz-gg", RunAsGroup: "voz-gg"},
	}
}

func baseOpts() setupOptions {
	return setupOptions{
		EnrollmentToken: "tok", WorkerBaseURL: "https://voz.gg",
		ConfigPath: "/etc/voz-gg-agent/monitor.json", ExecPath: "/usr/local/bin/voz-gg-agent",
		// A logparse-enabled, interactive test that forgets to set OpenTTY would
		// otherwise nil-panic deep in runSetupWith; fail it legibly instead.
		OpenTTY: func() (io.ReadWriteCloser, error) {
			panic("test must set opts.OpenTTY or opts.NonInteractive for logparse paths")
		},
	}
}

func TestSetupHappyPathCreatesUserConfigAndHardenedUnit(t *testing.T) {
	sys := newFakeSystem()
	var out, errb bytes.Buffer
	code := runSetupWith(baseOpts(), sys, fakeEnroll(sampleEnroll(), nil), &out, &errb)
	if code != 0 {
		t.Fatalf("exit = %d (stderr=%q)", code, errb.String())
	}
	if sys.createdGroups[0] != "voz-gg" || sys.createdUsers[0] != "voz-gg:voz-gg" {
		t.Fatalf("account not created: groups=%v users=%v", sys.createdGroups, sys.createdUsers)
	}
	cfg, ok := sys.files["/etc/voz-gg-agent/monitor.json"]
	if !ok {
		t.Fatal("config not written")
	}
	if sys.filePerms["/etc/voz-gg-agent/monitor.json"] != 0o600 {
		t.Fatalf("config perms = %o, want 600", sys.filePerms["/etc/voz-gg-agent/monitor.json"])
	}
	if !strings.Contains(string(cfg), `"agentToken": "AT"`) {
		t.Fatalf("config missing agent token: %s", cfg)
	}
	if got := sys.chowns; len(got) != 1 || got[0] != "/etc/voz-gg-agent voz-gg:voz-gg" {
		t.Fatalf("chown = %v", got)
	}
	unit := string(sys.files["/etc/systemd/system/voz-gg-agent-monitor.service"])
	for _, want := range []string{
		"User=voz-gg", "Group=voz-gg", "NoNewPrivileges=true", "ProtectSystem=strict",
		"ProtectHome=true", "PrivateTmp=true", "ReadWritePaths=/etc/voz-gg-agent",
		"ExecStart=/usr/local/bin/voz-gg-agent monitor -config /etc/voz-gg-agent/monitor.json",
	} {
		if !strings.Contains(unit, want) {
			t.Fatalf("unit missing %q:\n%s", want, unit)
		}
	}
	wantRuns := [][]string{{"systemctl", "daemon-reload"}, {"systemctl", "enable", "--now", "voz-gg-agent-monitor.service"}}
	if len(sys.runs) != 2 || sys.runs[0][1] != "daemon-reload" || sys.runs[1][3] != "voz-gg-agent-monitor.service" {
		t.Fatalf("runs = %v, want %v", sys.runs, wantRuns)
	}
}

func TestSetupSkipsAccountWhenItExists(t *testing.T) {
	sys := newFakeSystem()
	sys.groups["voz-gg"] = true
	sys.users["voz-gg"] = true
	runSetupWith(baseOpts(), sys, fakeEnroll(sampleEnroll(), nil), &bytes.Buffer{}, &bytes.Buffer{})
	if len(sys.createdGroups) != 0 || len(sys.createdUsers) != 0 {
		t.Fatalf("should not recreate existing account: groups=%v users=%v", sys.createdGroups, sys.createdUsers)
	}
}

func TestSetupRunAsResolution(t *testing.T) {
	// flag/env override wins over provisioning.
	opts := baseOpts()
	opts.RunAsUser = "svc"
	opts.RunAsGroup = "svcgrp"
	sys := newFakeSystem()
	runSetupWith(opts, sys, fakeEnroll(sampleEnroll(), nil), &bytes.Buffer{}, &bytes.Buffer{})
	if sys.createdUsers[0] != "svc:svcgrp" {
		t.Fatalf("override ignored: %v", sys.createdUsers)
	}

	// empty provisioning + no override falls back to voz-gg.
	resp := sampleEnroll()
	resp.Provisioning = provisioning{}
	sys2 := newFakeSystem()
	runSetupWith(baseOpts(), sys2, fakeEnroll(resp, nil), &bytes.Buffer{}, &bytes.Buffer{})
	if sys2.createdUsers[0] != "voz-gg:voz-gg" {
		t.Fatalf("default fallback wrong: %v", sys2.createdUsers)
	}
}

func TestSetupCleansUpLegacyUnit(t *testing.T) {
	sys := newFakeSystem()
	sys.units["voz-status-monitor.service"] = true
	runSetupWith(baseOpts(), sys, fakeEnroll(sampleEnroll(), nil), &bytes.Buffer{}, &bytes.Buffer{})
	foundDisable := false
	for _, r := range sys.runs {
		if len(r) >= 4 && r[0] == "systemctl" && r[1] == "disable" && r[3] == "voz-status-monitor.service" {
			foundDisable = true
		}
	}
	if !foundDisable {
		t.Fatalf("legacy unit not disabled: runs=%v", sys.runs)
	}
	if !contains(sys.removed, "/usr/local/bin/voz-status-monitor") {
		t.Fatalf("legacy binary not removed: %v", sys.removed)
	}
}

func TestSetupNoSystemdWritesConfigOnly(t *testing.T) {
	sys := newFakeSystem()
	sys.systemd = false
	var out bytes.Buffer
	code := runSetupWith(baseOpts(), sys, fakeEnroll(sampleEnroll(), nil), &out, &bytes.Buffer{})
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if _, ok := sys.files["/etc/voz-gg-agent/monitor.json"]; !ok {
		t.Fatal("config should still be written without systemd")
	}
	if len(sys.createdUsers) != 0 || len(sys.runs) != 0 {
		t.Fatal("no user/systemctl actions without systemd")
	}
}

func TestSetupEnrollErrorFails(t *testing.T) {
	sys := newFakeSystem()
	code := runSetupWith(baseOpts(), sys, fakeEnroll(enrollResponse{}, errSentinel), &bytes.Buffer{}, &bytes.Buffer{})
	if code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
	if len(sys.files) != 0 {
		t.Fatal("nothing should be written when enroll fails")
	}
}

func contains(ss []string, s string) bool {
	for _, v := range ss {
		if v == s {
			return true
		}
	}
	return false
}

type fakeTTY struct {
	in  *bytes.Buffer
	out *bytes.Buffer
}

func (f *fakeTTY) Read(p []byte) (int, error)  { return f.in.Read(p) }
func (f *fakeTTY) Write(p []byte) (int, error) { return f.out.Write(p) }
func (f *fakeTTY) Close() error                { return nil }

func TestResolveLogDirNonInteractiveUsesProvisionedPath(t *testing.T) {
	sys := newFakeSystem()
	cap := logParserCapability{Enabled: true, GameServerUser: "minecraft", LogPath: "/srv/mc/logs"}
	got, err := resolveLogDir(cap, false, nil, nil, sys)
	if err != nil || got != "/srv/mc/logs" {
		t.Fatalf("got %q err %v", got, err)
	}
}

func TestResolveLogDirNonInteractiveErrorsWhenMissing(t *testing.T) {
	sys := newFakeSystem()
	cap := logParserCapability{Enabled: true, GameServerUser: "minecraft"}
	if _, err := resolveLogDir(cap, false, nil, nil, sys); err == nil {
		t.Fatal("expected error when log path missing in non-interactive mode")
	}
}

func TestResolveLogDirInteractiveAcceptsDiscoveredDefault(t *testing.T) {
	sys := newFakeSystem()
	sys.paths["/home/minecraft/logs/latest.log"] = true                    // discovered candidate
	cap := logParserCapability{Enabled: true, GameServerUser: "minecraft"} // no provisioned path
	in := bytes.NewBufferString("\n")                                      // empty line accepts default
	out := &bytes.Buffer{}
	got, err := resolveLogDir(cap, true, in, out, sys)
	if err != nil || got != "/home/minecraft/logs" {
		t.Fatalf("got %q err %v; prompt=%q", got, err, out.String())
	}
	if !strings.Contains(out.String(), "/home/minecraft/logs") {
		t.Fatalf("prompt should list the discovered candidate: %q", out.String())
	}
}

func TestResolveLogDirInteractiveOverride(t *testing.T) {
	sys := newFakeSystem()
	cap := logParserCapability{Enabled: true, GameServerUser: "minecraft", LogPath: "/home/minecraft/logs"}
	in := bytes.NewBufferString("/opt/custom/logs\n")
	out := &bytes.Buffer{}
	got, err := resolveLogDir(cap, true, in, out, sys)
	if err != nil || got != "/opt/custom/logs" {
		t.Fatalf("got %q err %v", got, err)
	}
}

func TestFakeSystemPathExists(t *testing.T) {
	sys := newFakeSystem()
	sys.paths["/home/minecraft/logs/latest.log"] = true
	if !sys.pathExists("/home/minecraft/logs/latest.log") {
		t.Fatal("expected known path to exist")
	}
	if sys.pathExists("/nope") {
		t.Fatal("unknown path should not exist")
	}
}

func TestSetupParsesNonInteractiveFlag(t *testing.T) {
	// --non-interactive with missing required flags still errors on those (exit 2),
	// proving the flag is accepted by the flagset (not an "unknown flag" exit).
	var errb bytes.Buffer
	code := runSetup([]string{"--non-interactive"}, &bytes.Buffer{}, &errb)
	if code != 2 || !strings.Contains(errb.String(), "required") {
		t.Fatalf("expected required-flag error (exit 2), got code=%d err=%q", code, errb.String())
	}
}

func TestEnrollResponseDecodesLogParserCapability(t *testing.T) {
	raw := []byte(`{
		"agentToken": "AT",
		"configHash": "H1",
		"config": {"serverId": "srv1", "gameType": "minecraft-java"},
		"provisioning": {
			"runAsUser": "voz-gg",
			"runAsGroup": "voz-gg",
			"capabilities": {
				"monitor": {"enabled": true},
				"logParser": {"enabled": true, "gameServerUser": "minecraft", "logPath": "/home/minecraft/logs"}
			}
		}
	}`)
	var resp enrollResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		t.Fatal(err)
	}
	lp := resp.Provisioning.Capabilities.LogParser
	if !lp.Enabled || lp.GameServerUser != "minecraft" || lp.LogPath != "/home/minecraft/logs" {
		t.Fatalf("logParser not decoded: %+v", lp)
	}
}

func TestEnrollResponseWithoutCapabilityDefaultsDisabled(t *testing.T) {
	var resp enrollResponse
	if err := json.Unmarshal([]byte(`{"agentToken":"AT","provisioning":{"runAsUser":"voz-gg"}}`), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Provisioning.Capabilities.LogParser.Enabled {
		t.Fatal("missing capability must default to disabled")
	}
}

func TestRenderLogparseUnit(t *testing.T) {
	unit := renderLogparseUnit("/usr/local/bin/voz-gg-agent", "/etc/voz-gg-agent/monitor.json",
		"/home/minecraft/logs", "/var/lib/voz-gg-agent", "voz-gg", "voz-gg", "minecraft")
	for _, want := range []string{
		"Description=voz.gg agent (logparse)",
		"ExecStart=/usr/local/bin/voz-gg-agent logparse -config /etc/voz-gg-agent/monitor.json -log-dir /home/minecraft/logs -checkpoint /var/lib/voz-gg-agent/logparse-checkpoint.json",
		"User=voz-gg", "Group=voz-gg",
		"SupplementaryGroups=minecraft",
		"NoNewPrivileges=true", "ProtectSystem=strict", "ProtectHome=read-only", "PrivateTmp=true",
		"ReadOnlyPaths=/home/minecraft/logs",
		"ReadWritePaths=/var/lib/voz-gg-agent",
		"WantedBy=multi-user.target",
	} {
		if !strings.Contains(unit, want) {
			t.Fatalf("unit missing %q:\n%s", want, unit)
		}
	}
}

func TestRenderLogparseUnitOmitsSupplementaryGroupsWhenEmpty(t *testing.T) {
	unit := renderLogparseUnit("/x", "/c", "/logs", "/var/lib/voz-gg-agent", "voz-gg", "voz-gg", "")
	if strings.Contains(unit, "SupplementaryGroups=") {
		t.Fatalf("should omit SupplementaryGroups when gameServerUser empty:\n%s", unit)
	}
}

func logparseEnroll(logPath string) enrollResponse {
	resp := sampleEnroll()
	resp.Provisioning.Capabilities.LogParser = logParserCapability{
		Enabled: true, GameServerUser: "minecraft", LogPath: logPath,
	}
	return resp
}

func TestSetupSkipsLogparseWhenDisabled(t *testing.T) {
	sys := newFakeSystem()
	runSetupWith(baseOpts(), sys, fakeEnroll(sampleEnroll(), nil), &bytes.Buffer{}, &bytes.Buffer{})
	if _, ok := sys.files["/etc/systemd/system/voz-gg-agent-logparse.service"]; ok {
		t.Fatal("logparse unit must not be installed when capability is disabled")
	}
}

func TestSetupNonInteractiveInstallsLogparseUnit(t *testing.T) {
	sys := newFakeSystem()
	opts := baseOpts()
	opts.NonInteractive = true
	var out, errb bytes.Buffer
	code := runSetupWith(opts, sys, fakeEnroll(logparseEnroll("/home/minecraft/logs"), nil), &out, &errb)
	if code != 0 {
		t.Fatalf("exit = %d (stderr=%q)", code, errb.String())
	}
	unit, ok := sys.files["/etc/systemd/system/voz-gg-agent-logparse.service"]
	if !ok {
		t.Fatal("logparse unit not written")
	}
	for _, want := range []string{
		"-log-dir /home/minecraft/logs",
		"-checkpoint /var/lib/voz-gg-agent/logparse-checkpoint.json",
		"SupplementaryGroups=minecraft", "ProtectHome=read-only",
	} {
		if !strings.Contains(string(unit), want) {
			t.Fatalf("unit missing %q:\n%s", want, unit)
		}
	}
	if !contains(sys.chowns, "/var/lib/voz-gg-agent voz-gg:voz-gg") {
		t.Fatalf("state dir not chowned: %v", sys.chowns)
	}
	foundEnable := false
	reloads := 0
	for _, r := range sys.runs {
		if len(r) >= 4 && r[0] == "systemctl" && r[1] == "enable" && r[2] == "--now" && r[3] == "voz-gg-agent-logparse.service" {
			foundEnable = true
		}
		if len(r) == 2 && r[0] == "systemctl" && r[1] == "daemon-reload" {
			reloads++
		}
	}
	if !foundEnable {
		t.Fatalf("logparse unit not enabled --now: runs=%v", sys.runs)
	}
	// One daemon-reload for the monitor unit, one for the logparse unit.
	if reloads != 2 {
		t.Fatalf("expected 2 daemon-reload calls (monitor + logparse), got %d: runs=%v", reloads, sys.runs)
	}
}

func TestSetupNonInteractiveMissingLogPathFails(t *testing.T) {
	sys := newFakeSystem()
	opts := baseOpts()
	opts.NonInteractive = true
	code := runSetupWith(opts, sys, fakeEnroll(logparseEnroll(""), nil), &bytes.Buffer{}, &bytes.Buffer{})
	if code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
	if _, ok := sys.files["/etc/systemd/system/voz-gg-agent-logparse.service"]; ok {
		t.Fatal("no logparse unit should be written when the path is missing")
	}
}

func TestSetupInteractiveResolvesLogDirViaTTY(t *testing.T) {
	sys := newFakeSystem()
	opts := baseOpts() // NonInteractive=false
	tty := &fakeTTY{in: bytes.NewBufferString("/opt/mc/logs\n"), out: &bytes.Buffer{}}
	opts.OpenTTY = func() (io.ReadWriteCloser, error) { return tty, nil }
	code := runSetupWith(opts, sys, fakeEnroll(logparseEnroll("/home/minecraft/logs"), nil), &bytes.Buffer{}, &bytes.Buffer{})
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	unit := string(sys.files["/etc/systemd/system/voz-gg-agent-logparse.service"])
	if !strings.Contains(unit, "-log-dir /opt/mc/logs") {
		t.Fatalf("interactive override not applied:\n%s", unit)
	}
}

func TestSetupInteractiveTTYOpenFailureFails(t *testing.T) {
	sys := newFakeSystem()
	opts := baseOpts()
	opts.OpenTTY = func() (io.ReadWriteCloser, error) { return nil, errSentinel }
	var errb bytes.Buffer
	code := runSetupWith(opts, sys, fakeEnroll(logparseEnroll("/home/minecraft/logs"), nil), &bytes.Buffer{}, &errb)
	if code != 1 || !strings.Contains(errb.String(), "non-interactive") {
		t.Fatalf("expected tty-open failure to advise --non-interactive: code=%d err=%q", code, errb.String())
	}
}

// TestSetupPreservesRconPasswordOnRerun is a regression test for the mint-once
// violation: re-running setup over an existing install must not rotate the RCON
// password, otherwise the already-running JVM can no longer auth RCON stop.
func TestSetupPreservesRconPasswordOnRerun(t *testing.T) {
	// Pre-write a monitor.json with a known RCON password (simulates existing install).
	tmp := t.TempDir()
	configPath := filepath.Join(tmp, "monitor.json")
	if err := SaveConfig(configPath, Config{
		WorkerBaseURL: "https://voz.gg",
		AgentToken:    "old-AT",
		RCON:          rconConfig{Password: "keep-this-password", Port: 25575},
	}); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	resp := sampleEnroll()
	resp.Provisioning.Capabilities.ServerControl = serverControlCapability{
		Enabled: true, Slug: "survival", ServerUser: "minecraft",
		WorkingDir: "/home/minecraft/server", StartCommand: "./run.sh", RconPort: 25575,
	}

	sys := newFakeSystem()
	opts := baseOpts()
	opts.ConfigPath = configPath

	var out, errb bytes.Buffer
	code := runSetupWith(opts, sys, fakeEnroll(resp, nil), &out, &errb)
	if code != 0 {
		t.Fatalf("exit = %d (stderr=%q)", code, errb.String())
	}

	raw, ok := sys.files[configPath]
	if !ok {
		t.Fatal("config not written by setup")
	}
	var written Config
	if err := json.Unmarshal(raw, &written); err != nil {
		t.Fatalf("unmarshal written config: %v", err)
	}
	if written.RCON.Password != "keep-this-password" {
		t.Fatalf("RCON password rotated on re-run: got %q, want %q", written.RCON.Password, "keep-this-password")
	}
}
