package main

import (
	"fmt"
	"path/filepath"
)

// installLoader runs the loader apply lifecycle: snapshot (with world backup) →
// download+verify installer → run installer into a staging dir → validate markers
// → atomic promote → bridge symlinks → derive+write launch → stop → repoint →
// start → health-check → auto-revert on failed boot. The installer hash is the
// integrity gate; a mismatch aborts before any execution.
func installLoader(d applyDeps) (updateOutcome, error) {
	inst := d.desired.Install
	art := d.desired.Artifact
	if art == nil {
		return failed("apply", d.installed, d.desired.Version, "", fmt.Errorf("no installer artifact"))
	}
	now := d.now()
	snapID := snapshotID(now, d.installed)
	snapPath := filepath.Join(snapshotsRoot(d.workDir), snapID)

	// 1. Snapshot (hardlink) + real world backup.
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

	// 2. Download + verify the installer (no execution before the hash gate).
	tmpDir := filepath.Join(d.workDir, ".updates-tmp")
	_ = d.sys.removeAll(tmpDir)
	if err := d.sys.mkdirAll(tmpDir, 0o750); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	installerPath := filepath.Join(tmpDir, "installer.jar")
	if _, err := d.sys.downloadTo(art.URL, installerPath); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	sum, err := d.sys.hashFile(installerPath, art.HashAlgo)
	if err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	if sum != art.Hash {
		_ = d.sys.removeAll(tmpDir)
		return failed("apply", d.installed, d.desired.Version, snapID, fmt.Errorf("installer hash mismatch: got %s want %s", sum, art.Hash))
	}

	// 3. Run the installer into a staging dir while the server keeps running.
	staging := releaseDir(d.workDir, d.desired.Version) + ".staging"
	_ = d.sys.removeAll(staging)
	if err := d.sys.mkdirAll(staging, 0o755); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	if err := d.sys.runIn(staging, "java", installArgs(inst.Loader, installerPath, inst.MinecraftVersion, inst.LoaderVersion, staging)...); err != nil {
		_ = d.sys.removeAll(staging)
		_ = d.sys.removeAll(tmpDir)
		return failed("apply", d.installed, d.desired.Version, snapID, fmt.Errorf("installer failed: %w", err))
	}

	// 4. Validate the staged install, then atomically promote.
	for _, m := range markersFor(inst.Loader, inst.MinecraftVersion, inst.LoaderVersion) {
		if !d.sys.pathExists(filepath.Join(staging, m)) {
			_ = d.sys.removeAll(staging)
			_ = d.sys.removeAll(tmpDir)
			return failed("apply", d.installed, d.desired.Version, snapID, fmt.Errorf("staged install missing %s", m))
		}
	}
	rel := releaseDir(d.workDir, d.desired.Version)
	_ = d.sys.removeAll(rel)
	if err := d.sys.rename(staging, rel); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	_ = d.sys.removeAll(tmpDir)
	_ = d.sys.chownRecursive(rel, d.serverUser, d.serverUser)

	// 5. Bridge symlinks: working-dir entries → current/ so relative loader paths
	// resolve while world/mods stay shared. Stop first, then repoint current.
	priorTarget, _ := d.sys.readlink(currentLink(d.workDir))
	d.rconWarn("Server updating to " + d.desired.Version + "; restarting shortly")
	_ = d.sys.run("systemctl", "stop", gameUnit(d.slug))
	if err := d.sys.symlink(rel, currentLink(d.workDir)); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	for _, b := range bridgesFor(inst.Loader) {
		link := filepath.Join(d.workDir, b)
		_ = d.sys.removeAll(link)
		_ = d.sys.symlink(filepath.Join("current", b), link)
	}

	// 6. Write the derived launch into the game unit, then start + health-check.
	// Capture the prior unit so a failed boot can restore its ExecStart: the new
	// version-specific ExecStart references paths that only exist under the new
	// release, so reverting current alone would leave an unbootable unit.
	unitFile := "/etc/systemd/system/" + serverControlUnitName(d.slug)
	priorUnit, _ := d.sys.readFile(unitFile)
	launch := deriveLaunch(inst.Loader, inst.LoaderVersion, inst.MinecraftVersion, d.jvmArgs)
	if err := writeGameUnitExecStart(d.sys, d.slug, d.serverUser, d.workDir, launch, d.execPath, d.configPath); err != nil {
		return failed("apply", d.installed, d.desired.Version, snapID, err)
	}
	_ = d.sys.run("systemctl", "daemon-reload")
	_ = d.sys.run("systemctl", "start", gameUnit(d.slug))

	if err := d.healthCheck(); err != nil {
		// Auto-revert: repoint current to prior release + restore world + restore
		// the prior unit's ExecStart, then start.
		_ = d.sys.run("systemctl", "stop", gameUnit(d.slug))
		if priorTarget != "" {
			_ = d.sys.symlink(priorTarget, currentLink(d.workDir))
		}
		_ = restoreWorld(d.sys, d.workDir, snapPath)
		if len(priorUnit) > 0 {
			_ = d.sys.writeFile(unitFile, priorUnit, 0o644)
			_ = d.sys.run("systemctl", "daemon-reload")
		}
		_ = d.sys.run("systemctl", "start", gameUnit(d.slug))
		return updateOutcome{Kind: "auto_revert", From: d.desired.Version, To: d.installed, SnapshotID: snapID, Status: "failed", Error: err.Error()}, nil
	}
	return updateOutcome{Kind: "apply", From: d.installed, To: d.desired.Version, SnapshotID: snapID, Status: "success"}, nil
}

// writeGameUnitExecStart rewrites the game-server unit with a new ExecStart
// (derived from the installed loader). Task 18 moves this to server_control.go
// as the canonical home; it lives here for now.
func writeGameUnitExecStart(sys systemOps, slug, user, workingDir, execStart, execPath, configPath string) error {
	unit := renderServerControlUnit(execPath, slug, user, workingDir, execStart, configPath)
	return sys.writeFile("/etc/systemd/system/"+serverControlUnitName(slug), []byte(unit), 0o644)
}
