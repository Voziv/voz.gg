package main

import (
	"bytes"
	"encoding/json"
	"errors"
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
	removed       []string
}

func newFakeSystem() *fakeSystem {
	return &fakeSystem{
		systemd: true,
		groups:  map[string]bool{}, users: map[string]bool{},
		files: map[string][]byte{}, filePerms: map[string]uint32{},
		units: map[string]bool{},
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
func (f *fakeSystem) chownRecursive(p, u, g string) error {
	f.chowns = append(f.chowns, p+" "+u+":"+g)
	return nil
}
func (f *fakeSystem) run(name string, args ...string) error {
	f.runs = append(f.runs, append([]string{name}, args...))
	return nil
}
func (f *fakeSystem) unitInstalled(n string) bool { return f.units[n] }
func (f *fakeSystem) remove(p string) error       { f.removed = append(f.removed, p); return nil }

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
