package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"voz.gg/services/voz-gg-agent/rcon"
)

// updatesCapability mirrors apps/web buildProvisioning's capabilities.updates.
// Operational fields (slug, serverUser, workingDir, rconPort, restartSchedule)
// are NOT here — they are read from the serverControl capability, which updates
// requires.
type updatesCapability struct {
	Enabled bool            `json:"enabled"`
	Policy  string          `json:"policy"`
	Desired *desiredRelease `json:"desired"`
}

type desiredInstall struct {
	Loader           string `json:"loader"`
	MinecraftVersion string `json:"minecraftVersion"`
	LoaderVersion    string `json:"loaderVersion"`
}

type desiredRelease struct {
	ID         string           `json:"id"`
	Kind       string           `json:"kind"` // "apply" | "rollback"
	Version    string           `json:"version"`
	Artifact   *desiredArtifact `json:"artifact"`
	SnapshotID string           `json:"snapshotId"`
	Install    *desiredInstall  `json:"install"`
}

type desiredArtifact struct {
	URL      string `json:"url"`
	HashAlgo string `json:"hashAlgo"`
	Hash     string `json:"hash"`
	Size     int64  `json:"size"`
}

var listRe = regexp.MustCompile(`There are (\d+) of a max`)

func parseOnlinePlayers(out string) (int, bool) {
	m := listRe.FindStringSubmatch(out)
	if m == nil {
		return 0, false
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		return 0, false
	}
	return n, true
}

func withinRestartWindow(now time.Time, scheduleHHMM string, windowMin int) bool {
	if scheduleHHMM == "" {
		return false
	}
	t, err := time.Parse("15:04", scheduleHHMM)
	if err != nil {
		return false
	}
	u := now.UTC()
	start := time.Date(u.Year(), u.Month(), u.Day(), t.Hour(), t.Minute(), 0, 0, time.UTC)
	return !u.Before(start) && u.Before(start.Add(time.Duration(windowMin)*time.Minute))
}

type triggerGate struct {
	Empty      bool
	KnownEmpty bool // false when the player count could not be determined
	Now        time.Time
	Schedule   string
}

const restartWindowMinutes = 15

// shouldApplyNow gates an apply on the empty-first / restart-window-fallback rule.
// An empty server applies immediately; a non-empty (or unknown-occupancy) server
// applies only inside the restart window (forced, with an RCON warning upstream).
func shouldApplyNow(g triggerGate) bool {
	if g.KnownEmpty && g.Empty {
		return true
	}
	return withinRestartWindow(g.Now, g.Schedule, restartWindowMinutes)
}

type reconcileAction struct {
	Kind string // "none" | "apply" | "rollback"
}

// planReconcile decides whether the installed state must converge to the desired
// release. Apply is satisfied when installed already equals the target version;
// any kind is satisfied once its generation id has been handled.
func planReconcile(installed string, d *desiredRelease, handledID string) reconcileAction {
	if d == nil {
		return reconcileAction{Kind: "none"}
	}
	if d.ID != "" && d.ID == handledID {
		return reconcileAction{Kind: "none"}
	}
	switch d.Kind {
	case "apply":
		if installed == d.Version {
			return reconcileAction{Kind: "none"}
		}
		return reconcileAction{Kind: "apply"}
	case "rollback":
		return reconcileAction{Kind: "rollback"}
	}
	return reconcileAction{Kind: "none"}
}

func snapshotsRoot(workingDir string) string { return filepath.Join(workingDir, "snapshots") }
func releasesRoot(workingDir string) string  { return filepath.Join(workingDir, "releases") }
func releaseDir(workingDir, version string) string {
	return filepath.Join(releasesRoot(workingDir), version)
}
func currentLink(workingDir string) string { return filepath.Join(workingDir, "current") }

func snapshotID(now time.Time, preVersion string) string {
	ts := now.UTC().Format("2006-01-02T150405Z")
	return ts + "-pre-" + preVersion
}

// snapshotsToPrune returns the oldest snapshot names to remove so that at most
// `keep` remain. Inputs are expected to sort chronologically by name (the
// timestamp prefix guarantees it); we sort defensively.
func snapshotsToPrune(existing []string, keep int) []string {
	sorted := append([]string(nil), existing...)
	sort.Strings(sorted)
	if len(sorted) <= keep {
		return nil
	}
	return sorted[:len(sorted)-keep]
}

const snapshotRetention = 3

type updateOutcome struct {
	Kind       string // "apply" | "auto_revert" | "rollback" | "adopt"
	From       string
	To         string
	SnapshotID string
	Status     string // "success" | "failed"
	Error      string
}

type applyDeps struct {
	sys         systemOps
	now         func() time.Time
	workDir     string
	slug        string
	serverUser  string
	desired     *desiredRelease
	installed   string
	healthCheck func() error                 // returns nil once the server answers RCON
	rconWarn    func(string)                 // best-effort player warning before a forced stop
	rconExec    func(string) (string, error) // full RCON for world quiesce during backup
	jvmArgs     string
	execPath    string
	configPath  string
}

const gameUnitPrefix = "voz-gg-"

func gameUnit(slug string) string { return gameUnitPrefix + slug + ".service" }

// applyUpdate runs the full apply lifecycle for a desired apply: snapshot →
// download+verify → stage release → stop → repoint current → start → health-check,
// auto-reverting to the snapshot on a failed boot. The server jar hash is the
// integrity gate; a mismatch aborts before any swap.
func applyUpdate(d applyDeps) (updateOutcome, error) {
	if d.desired.Install != nil {
		return installLoader(d)
	}
	art := d.desired.Artifact
	if art == nil {
		return updateOutcome{Kind: "apply", Status: "failed", Error: "no artifact in desired"}, fmt.Errorf("no artifact")
	}
	now := d.now()
	snapID := snapshotID(now, d.installed)
	snapPath := filepath.Join(snapshotsRoot(d.workDir), snapID)

	// 1. Snapshot the working dir (hardlink-based), then prune.
	if err := d.sys.mkdirAll(snapshotsRoot(d.workDir), 0o750); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	if err := d.sys.copyTreeHardlink(d.workDir, snapPath); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	if err := backupWorld(d.sys, d.workDir, snapPath, d.rconExec); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	pruneSnapshots(d.sys, d.workDir)

	// 2. Stage the release: download + verify before any swap.
	rel := releaseDir(d.workDir, d.desired.Version)
	if err := d.sys.mkdirAll(rel, 0o755); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	jarPath := filepath.Join(rel, "server.jar")
	if _, err := d.sys.downloadTo(art.URL, jarPath); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	sum, err := d.sys.hashFile(jarPath, art.HashAlgo)
	if err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	if sum != art.Hash {
		_ = d.sys.removeAll(rel)
		return failed("apply", d.installed, d.desired.Version, snapID, fmt.Errorf("hash mismatch: got %s want %s", sum, art.Hash))
	}
	_ = d.sys.chownRecursive(rel, d.serverUser, d.serverUser)

	// 3. Capture the prior current target for possible revert, then swap.
	priorTarget, _ := d.sys.readlink(currentLink(d.workDir))
	d.rconWarn("Server updating to " + d.desired.Version + "; restarting shortly")
	_ = d.sys.run("systemctl", "stop", gameUnit(d.slug))
	if err := d.sys.symlink(rel, currentLink(d.workDir)); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	_ = d.sys.run("systemctl", "start", gameUnit(d.slug))

	// 4. Health-check; auto-revert on failure.
	if err := d.healthCheck(); err != nil {
		_ = d.sys.run("systemctl", "stop", gameUnit(d.slug))
		if priorTarget != "" {
			_ = d.sys.symlink(priorTarget, currentLink(d.workDir))
		}
		_ = d.sys.run("systemctl", "start", gameUnit(d.slug))
		return updateOutcome{Kind: "auto_revert", From: d.desired.Version, To: d.installed, SnapshotID: snapID, Status: "failed", Error: err.Error()}, nil
	}

	return updateOutcome{Kind: "apply", From: d.installed, To: d.desired.Version, SnapshotID: snapID, Status: "success"}, nil
}

func failed(kind, from, to, snap string, err error) (updateOutcome, error) {
	return updateOutcome{Kind: kind, From: from, To: to, SnapshotID: snap, Status: "failed", Error: err.Error()}, err
}

// pruneSnapshots removes the oldest snapshot dirs beyond the retention cap.
func pruneSnapshots(sys systemOps, workDir string) {
	names, err := sys.listDir(snapshotsRoot(workDir))
	if err != nil {
		return
	}
	for _, name := range snapshotsToPrune(names, snapshotRetention) {
		_ = sys.removeAll(filepath.Join(snapshotsRoot(workDir), name))
	}
}

func rollbackUpdate(d applyDeps) (updateOutcome, error) {
	snap := d.desired.SnapshotID
	snapPath := filepath.Join(snapshotsRoot(d.workDir), snap)
	if !d.sys.pathExists(snapPath) {
		return updateOutcome{Kind: "rollback", Status: "failed", SnapshotID: snap, Error: "snapshot not found"}, fmt.Errorf("snapshot %s not found", snap)
	}
	d.rconWarn("Server rolling back; restarting shortly")
	_ = d.sys.run("systemctl", "stop", gameUnit(d.slug))
	// The snapshot is a full working-dir copy; repoint current to the release the
	// snapshot recorded, which is sufficient for a vanilla rollback since persistent
	// state was captured alongside it.
	target, err := d.sys.readlink(filepath.Join(snapPath, "current"))
	if err == nil && target != "" {
		_ = d.sys.symlink(target, currentLink(d.workDir))
	}
	_ = restoreWorld(d.sys, d.workDir, snapPath)
	_ = d.sys.run("systemctl", "start", gameUnit(d.slug))
	if err := d.healthCheck(); err != nil {
		return updateOutcome{Kind: "rollback", Status: "failed", SnapshotID: snap, Error: err.Error()}, nil
	}
	return updateOutcome{Kind: "rollback", To: snap, SnapshotID: snap, Status: "success"}, nil
}

type adoptDeps struct {
	sys        systemOps
	now        func() time.Time
	workDir    string
	slug       string
	serverUser string
	openJar    func(path string) (io.ReaderAt, int64, error)
}

// adoptLayout performs one-time guided adoption of an existing flat server into
// the canonical layout: identify the installed version from the jar, snapshot,
// move the jar under releases/<version>/, and create the current symlink. Refuses
// (error) when the version cannot be identified, leaving the server untouched.
func adoptLayout(a adoptDeps) (updateOutcome, error) {
	flatJar := filepath.Join(a.workDir, "server.jar")
	if !a.sys.pathExists(flatJar) {
		return updateOutcome{Kind: "adopt", Status: "failed", Error: "no server.jar to adopt"}, fmt.Errorf("no server.jar")
	}
	r, size, err := a.openJar(flatJar)
	if err != nil {
		return updateOutcome{Kind: "adopt", Status: "failed", Error: err.Error()}, err
	}
	version, err := jarVersion(r, size)
	if err != nil {
		return updateOutcome{Kind: "adopt", Status: "failed", Error: "could not identify version: " + err.Error()}, err
	}
	snapID := snapshotID(a.now(), version)
	if err := a.sys.mkdirAll(snapshotsRoot(a.workDir), 0o750); err == nil {
		_ = a.sys.copyTreeHardlink(a.workDir, filepath.Join(snapshotsRoot(a.workDir), snapID))
		_ = backupWorld(a.sys, a.workDir, filepath.Join(snapshotsRoot(a.workDir), snapID), func(string) (string, error) {
			return "", fmt.Errorf("no rcon during adopt")
		})
	}
	rel := releaseDir(a.workDir, version)
	if err := a.sys.mkdirAll(rel, 0o755); err != nil {
		return updateOutcome{Kind: "adopt", Status: "failed", Error: err.Error()}, err
	}
	if err := a.sys.rename(flatJar, filepath.Join(rel, "server.jar")); err != nil {
		return updateOutcome{Kind: "adopt", Status: "failed", Error: err.Error()}, err
	}
	_ = a.sys.chownRecursive(rel, a.serverUser, a.serverUser)
	if err := a.sys.symlink(rel, currentLink(a.workDir)); err != nil {
		return updateOutcome{Kind: "adopt", Status: "failed", Error: err.Error()}, err
	}
	return updateOutcome{Kind: "adopt", To: version, SnapshotID: snapID, Status: "success"}, nil
}

const (
	updatesUnitName  = "voz-gg-agent-updates.service"
	updatesTimerName = "voz-gg-agent-updates.timer"
)

func renderUpdatesService(execPath, configPath, serverWorkingDir, stateDir string) string {
	return fmt.Sprintf(`[Unit]
Description=voz.gg agent (updates apply)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=%s updates --reconcile-once -config %s
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%s %s
`, execPath, configPath, serverWorkingDir, stateDir)
}

func renderUpdatesTimer() string {
	return `[Unit]
Description=voz.gg agent (updates apply) timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
`
}

// reconcileUpdates installs/removes the updates timer to match the capability.
// Like reconcileLogparse it is shared by setup and reprovision. The unit is
// privileged (writes the server dir, runs systemctl, chowns), so its
// ReadWritePaths are scoped to the server working dir + the agent state dir.
func reconcileUpdates(sys systemOps, uc updatesCapability, sc serverControlCapability, execPath, configPath string, stdout io.Writer) error {
	if !uc.Enabled {
		if sys.unitInstalled(updatesTimerName) || sys.unitInstalled(updatesUnitName) {
			_ = sys.run("systemctl", "disable", "--now", updatesTimerName)
			_ = sys.remove("/etc/systemd/system/" + updatesTimerName)
			_ = sys.remove("/etc/systemd/system/" + updatesUnitName)
			_ = sys.run("systemctl", "daemon-reload")
			fmt.Fprintln(stdout, "voz-gg-agent updates disabled and removed")
		}
		return nil
	}
	if !sys.hasSystemd() {
		fmt.Fprintln(stdout, "updates: systemd not found; skipping unit install")
		return nil
	}
	if sc.WorkingDir == "" {
		return fmt.Errorf("updates enabled but server control has no working dir")
	}
	if err := sys.mkdirAll(stateDir, 0o750); err != nil {
		return fmt.Errorf("mkdir %s: %w", stateDir, err)
	}
	svc := renderUpdatesService(execPath, configPath, sc.WorkingDir, stateDir)
	if err := sys.writeFile("/etc/systemd/system/"+updatesUnitName, []byte(svc), 0o644); err != nil {
		return err
	}
	if err := sys.writeFile("/etc/systemd/system/"+updatesTimerName, []byte(renderUpdatesTimer()), 0o644); err != nil {
		return err
	}
	if err := sys.run("systemctl", "daemon-reload"); err != nil {
		return err
	}
	if err := sys.run("systemctl", "enable", "--now", updatesTimerName); err != nil {
		return err
	}
	fmt.Fprintln(stdout, "voz-gg-agent updates installed (timer enabled)")
	return nil
}

type reportEvent struct {
	Kind        string `json:"kind"`
	FromVersion string `json:"fromVersion"`
	ToVersion   string `json:"toVersion"`
	Status      string `json:"status"`
	SnapshotID  string `json:"snapshotId"`
	Error       string `json:"error"`
	At          string `json:"at"`
}
type reportSnapshot struct {
	SnapshotID string `json:"snapshotId"`
	CreatedAt  string `json:"createdAt"`
	Version    string `json:"version"`
	SizeBytes  *int64 `json:"sizeBytes"`
}
type updatesReportBody struct {
	InstalledVersion *string          `json:"installedVersion"`
	ApplyStatus      string           `json:"applyStatus"`
	ApplyError       *string          `json:"applyError"`
	LastEvent        *reportEvent     `json:"lastEvent"`
	Snapshots        []reportSnapshot `json:"snapshots"`
}

func postUpdatesReport(workerBaseURL, agentToken string, body updatesReportBody) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, workerBaseURL+"/api/agents/updates", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+agentToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("updates report returned %d: %s", resp.StatusCode, b)
	}
	return nil
}

func runUpdates(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("updates", flag.ContinueOnError)
	fs.SetOutput(stderr)
	configPath := fs.String("config", defaultConfigPath, "path to the agent config json")
	reconcileOnce := fs.Bool("reconcile-once", false, "run a single reconcile tick and exit")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	_ = *reconcileOnce // the timer always invokes one-shot; the flag documents intent
	cfg, err := LoadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(stderr, "updates: load config: %v\n", err)
		return 1
	}
	execPath, _ := os.Executable()
	rconAddr := net.JoinHostPort("127.0.0.1", strconv.Itoa(cfg.RCON.Port))
	rconExec := func(cmd string) (string, error) { return rcon.Run(rconAddr, cfg.RCON.Password, cmd, 10*time.Second) }
	return reconcileUpdatesTick(updatesTickDeps{
		cfg: cfg, configPath: *configPath, execPath: execPath,
		sys: realSystem{}, now: time.Now, rconExec: rconExec,
		fetchProvision: httpProvision, save: func(c Config) error { return SaveConfig(*configPath, c) },
		stdout: stdout, stderr: stderr,
	})
}

type updatesTickDeps struct {
	cfg            Config
	configPath     string
	execPath       string
	sys            systemOps
	now            func() time.Time
	rconExec       func(cmd string) (string, error)
	fetchProvision provisionFn
	save           func(Config) error
	stdout, stderr io.Writer
}

// reconcileUpdatesTick runs one apply reconcile: refresh provisioning, decide the
// action, gate on the trigger, execute, persist the handled id, and report state.
// It returns 0 on "nothing to do" and on deferred applies.
func reconcileUpdatesTick(d updatesTickDeps) int {
	resp, err := d.fetchProvision(d.cfg.WorkerBaseURL, d.cfg.AgentToken)
	if err != nil {
		fmt.Fprintf(d.stderr, "updates: provision fetch: %v\n", err)
		return 1
	}
	uc := resp.Provisioning.Capabilities.Updates
	sc := resp.Provisioning.Capabilities.ServerControl
	if !uc.Enabled || sc.WorkingDir == "" {
		return 0
	}
	installed := installedVersion(d.sys, sc.WorkingDir)

	// Adoption: a flat server (no current symlink) is adopted before any apply.
	// When the desired release carries a loader install descriptor, use the
	// loader-aware path; otherwise fall back to vanilla jar adoption.
	if !d.sys.pathExists(currentLink(sc.WorkingDir)) {
		var out updateOutcome
		var err error
		if uc.Desired != nil && uc.Desired.Install != nil {
			out, err = adoptLoaderLayout(
				adoptDeps{sys: d.sys, now: d.now, workDir: sc.WorkingDir, slug: sc.Slug, serverUser: sc.ServerUser},
				uc.Desired.Install, sc.JvmArgs, d.execPath, d.configPath,
			)
		} else {
			out, err = adoptLayout(adoptDeps{sys: d.sys, now: d.now, workDir: sc.WorkingDir, slug: sc.Slug, serverUser: sc.ServerUser, openJar: openJarFile})
		}
		report(d, uc, sc, installedVersion(d.sys, sc.WorkingDir), out)
		if err != nil {
			fmt.Fprintf(d.stderr, "updates: adoption: %v\n", err)
			return 0
		}
		installed = out.To
	}

	action := planReconcile(installed, uc.Desired, d.cfg.Updates.HandledDesiredID)
	if action.Kind == "none" {
		report(d, uc, sc, installed, updateOutcome{})
		return 0
	}

	count, known := rconPlayerCount(d.rconExec)
	gate := triggerGate{Empty: count == 0, KnownEmpty: known, Now: d.now(), Schedule: sc.RestartSchedule}
	if action.Kind == "apply" && !shouldApplyNow(gate) {
		reportPending(d, uc, sc, installed)
		return 0
	}

	deps := applyDeps{
		sys: d.sys, now: d.now, workDir: sc.WorkingDir, slug: sc.Slug, serverUser: sc.ServerUser,
		desired: uc.Desired, installed: installed,
		healthCheck: func() error { return rconHealthCheck(d.rconExec) },
		rconWarn:    func(msg string) { _, _ = d.rconExec("say " + msg) },
		rconExec:    d.rconExec,
		jvmArgs:     sc.JvmArgs,
		execPath:    d.execPath,
		configPath:  d.configPath,
	}
	var out updateOutcome
	if action.Kind == "rollback" {
		out, _ = rollbackUpdate(deps)
	} else {
		out, _ = applyUpdate(deps)
	}

	// Persist handled id so we do not re-run this desired next tick.
	d.cfg.Updates.HandledDesiredID = uc.Desired.ID
	if err := d.save(d.cfg); err != nil {
		fmt.Fprintf(d.stderr, "updates: save handled id: %v\n", err)
	}
	report(d, uc, sc, installedVersion(d.sys, sc.WorkingDir), out)
	return 0
}

func openJarFile(path string) (io.ReaderAt, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, 0, err
	}
	return f, info.Size(), nil
}

// installedVersion reads the version from the current symlink target dir name.
func installedVersion(sys systemOps, workDir string) string {
	target, err := sys.readlink(currentLink(workDir))
	if err != nil || target == "" {
		return ""
	}
	return filepath.Base(target)
}

func rconPlayerCount(exec func(string) (string, error)) (int, bool) {
	out, err := exec("list")
	if err != nil {
		return 0, false
	}
	return parseOnlinePlayers(out)
}

func rconHealthCheck(exec func(string) (string, error)) error {
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := exec("list"); err == nil {
			return nil
		}
		time.Sleep(3 * time.Second)
	}
	return fmt.Errorf("server did not answer rcon within timeout")
}

// parseSnapshotName recovers the creation time + pre-apply version encoded in a
// snapshot dir name ("2006-01-02T150405Z-pre-<version>"). Falls back to now() and
// "" when the name does not match (defensive; all names we create do match).
func parseSnapshotName(name string, now func() time.Time) (string, string) {
	createdAt := now().UTC().Format(time.RFC3339)
	version := ""
	if i := strings.Index(name, "-pre-"); i >= 0 {
		if t, err := time.Parse("2006-01-02T150405Z", name[:i]); err == nil {
			createdAt = t.UTC().Format(time.RFC3339)
		}
		version = name[i+len("-pre-"):]
	}
	return createdAt, version
}

func snapshotInventory(sys systemOps, workDir string, now func() time.Time) []reportSnapshot {
	names, _ := sys.listDir(snapshotsRoot(workDir))
	out := make([]reportSnapshot, 0, len(names))
	for _, n := range names {
		createdAt, version := parseSnapshotName(n, now)
		out = append(out, reportSnapshot{SnapshotID: n, CreatedAt: createdAt, Version: version, SizeBytes: nil})
	}
	return out
}

func report(d updatesTickDeps, uc updatesCapability, sc serverControlCapability, installed string, out updateOutcome) {
	status := "idle"
	var ev *reportEvent
	var applyErr *string
	if out.Status != "" {
		if out.Status == "success" {
			status = "done"
		} else {
			status = "failed"
			e := out.Error
			applyErr = &e
		}
		ev = &reportEvent{Kind: out.Kind, FromVersion: out.From, ToVersion: out.To, Status: out.Status, SnapshotID: out.SnapshotID, Error: out.Error, At: d.now().UTC().Format(time.RFC3339)}
	}
	var iv *string
	if installed != "" {
		iv = &installed
	}
	body := updatesReportBody{
		InstalledVersion: iv, ApplyStatus: status, ApplyError: applyErr, LastEvent: ev,
		Snapshots: snapshotInventory(d.sys, sc.WorkingDir, d.now),
	}
	if err := postUpdatesReport(d.cfg.WorkerBaseURL, d.cfg.AgentToken, body); err != nil {
		fmt.Fprintf(d.stderr, "updates: report: %v\n", err)
	}
}

func reportPending(d updatesTickDeps, uc updatesCapability, sc serverControlCapability, installed string) {
	var iv *string
	if installed != "" {
		iv = &installed
	}
	_ = postUpdatesReport(d.cfg.WorkerBaseURL, d.cfg.AgentToken, updatesReportBody{
		InstalledVersion: iv, ApplyStatus: "pending", Snapshots: snapshotInventory(d.sys, sc.WorkingDir, d.now),
	})
}
