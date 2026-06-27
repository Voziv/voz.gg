package main

import (
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
