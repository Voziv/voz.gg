package main

import (
	"fmt"
	"path/filepath"
	"strings"
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

// adoptLoaderLayout adopts a flat loader install into the canonical layout:
// identify the installed version from the file listing (using the Worker-declared
// loader type as the parser), snapshot, move loader artifacts into
// releases/<version>/, create bridge symlinks, write the derived launch, and
// create the current symlink. The loader TYPE is the cross-check; the on-disk
// version is recovered directly and adopted as-is (it is almost always older than
// the desired version, which is expected). Aborts on error, touching nothing.
func adoptLoaderLayout(a adoptDeps, inst *desiredInstall, jvmArgs, execPath, configPath string) (updateOutcome, error) {
	if inst == nil {
		return updateOutcome{Kind: "adopt", Status: "failed", Error: "no install descriptor"}, fmt.Errorf("no install descriptor")
	}

	listing := a.sys.walkFiles(a.workDir)

	var version string
	switch inst.Loader {
	case "fabric":
		// Fabric has no version in its launch jar name; confirm a fabric launch
		// jar is present then trust the Worker-declared loader version.
		var found bool
		for _, p := range listing {
			if fabricLaunchRe.MatchString(p) {
				found = true
				break
			}
		}
		if !found {
			e := fmt.Errorf("no fabric-server-launch.jar in flat install")
			return updateOutcome{Kind: "adopt", Status: "failed", Error: e.Error()}, e
		}
		version = inst.LoaderVersion
	default:
		// neoforge / forge: recover the version from the libraries path.
		v, err := identifyFlatInstall(inst.Loader, listing)
		if err != nil {
			e := fmt.Errorf("cannot identify %s flat install: %w", inst.Loader, err)
			return updateOutcome{Kind: "adopt", Status: "failed", Error: e.Error()}, e
		}
		version = v
	}

	// Snapshot the pre-adoption state.
	snapID := snapshotID(a.now(), version)
	snapPath := filepath.Join(snapshotsRoot(a.workDir), snapID)
	if err := a.sys.mkdirAll(snapshotsRoot(a.workDir), 0o750); err == nil {
		_ = a.sys.copyTreeHardlink(a.workDir, snapPath)
		_ = backupWorld(a.sys, a.workDir, snapPath, func(string) (string, error) {
			return "", fmt.Errorf("no rcon during adopt")
		})
	}

	// Move loader artifacts into releases/<version>/.
	rel := releaseDir(a.workDir, version)
	if err := a.sys.mkdirAll(rel, 0o755); err != nil {
		return updateOutcome{Kind: "adopt", Status: "failed", Error: err.Error()}, err
	}
	// Track moved artifacts so a mid-loop rename failure can be rolled back,
	// leaving the flat install intact for the next tick to re-identify.
	var moved [][2]string
	for _, name := range loaderArtifactNames(inst.Loader) {
		src := filepath.Join(a.workDir, name)
		dst := filepath.Join(rel, name)
		if a.sys.pathExists(src) {
			if err := a.sys.rename(src, dst); err != nil {
				for _, m := range moved {
					_ = a.sys.rename(m[1], m[0])
				}
				return updateOutcome{Kind: "adopt", Status: "failed", Error: err.Error()}, err
			}
			moved = append(moved, [2]string{src, dst})
		}
	}
	_ = a.sys.chownRecursive(rel, a.serverUser, a.serverUser)

	if err := a.sys.symlink(rel, currentLink(a.workDir)); err != nil {
		return updateOutcome{Kind: "adopt", Status: "failed", Error: err.Error()}, err
	}

	// Bridge symlinks: working-dir entries → current/ so loader relative paths resolve.
	for _, b := range bridgesFor(inst.Loader) {
		link := filepath.Join(a.workDir, b)
		_ = a.sys.removeAll(link)
		_ = a.sys.symlink(filepath.Join("current", b), link)
	}

	// Derive the launch from the RECOVERED on-disk version (which is what `current`
	// now points at), not the desired version — they normally differ. Forge's
	// recovered version is the composite <mc>-<build>, so split it for deriveLaunch.
	launchLoaderVersion := version
	launchMc := inst.MinecraftVersion
	if inst.Loader == "forge" {
		if dash := strings.IndexByte(version, '-'); dash >= 0 {
			launchMc = version[:dash]
			launchLoaderVersion = version[dash+1:]
		}
	}
	launch := deriveLaunch(inst.Loader, launchLoaderVersion, launchMc, jvmArgs)
	if err := writeGameUnitExecStart(a.sys, a.slug, a.serverUser, a.workDir, launch, execPath, configPath); err != nil {
		return updateOutcome{Kind: "adopt", Status: "failed", Error: err.Error()}, err
	}

	return updateOutcome{Kind: "adopt", To: version, SnapshotID: snapID, Status: "success"}, nil
}
