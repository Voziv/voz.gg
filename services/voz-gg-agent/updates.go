package main

import (
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"time"
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

type desiredRelease struct {
	ID         string           `json:"id"`
	Kind       string           `json:"kind"` // "apply" | "rollback"
	Version    string           `json:"version"`
	Artifact   *desiredArtifact `json:"artifact"`
	SnapshotID string           `json:"snapshotId"`
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
	healthCheck func() error // returns nil once the server answers RCON
	rconWarn    func(string) // best-effort player warning before a forced stop
}

const gameUnitPrefix = "voz-gg-"

func gameUnit(slug string) string { return gameUnitPrefix + slug + ".service" }

// applyUpdate runs the full apply lifecycle for a desired apply: snapshot →
// download+verify → stage release → stop → repoint current → start → health-check,
// auto-reverting to the snapshot on a failed boot. The server jar hash is the
// integrity gate; a mismatch aborts before any swap.
func applyUpdate(d applyDeps) (updateOutcome, error) {
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
