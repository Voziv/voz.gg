package main

import (
	"fmt"
	"path/filepath"
)

// worldDirs returns the names of world directories inside workDir.
// A directory n is a world when workDir/n/level.dat exists. The companion
// nether (n_nether) and end (n_the_end) directories are included when they
// exist, even if they lack their own level.dat (Paper/Spigot layout).
func worldDirs(sys systemOps, workDir string) []string {
	entries, _ := sys.listDir(workDir)
	seen := map[string]bool{}
	worlds := []string{}
	addIfNew := func(n string) {
		if !seen[n] {
			seen[n] = true
			worlds = append(worlds, n)
		}
	}
	for _, n := range entries {
		if sys.pathExists(filepath.Join(workDir, n, "level.dat")) {
			addIfNew(n)
			if sys.pathExists(filepath.Join(workDir, n+"_nether")) {
				addIfNew(n + "_nether")
			}
			if sys.pathExists(filepath.Join(workDir, n+"_the_end")) {
				addIfNew(n + "_the_end")
			}
		}
	}
	return worlds
}

// copyWorldDir copies src to dst, preferring a CoW reflink and falling back to
// a full deep copy.
func copyWorldDir(sys systemOps, src, dst string) error {
	ok, err := sys.reflinkCopy(src, dst)
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	return sys.copyTreeDeep(src, dst)
}

// backupWorld quiesces the running server via RCON and copies each world
// directory into snapPath. Returns nil immediately when no world directories
// are detected, so callers with a nil/empty rconExec are safe when no worlds
// are present.
func backupWorld(sys systemOps, workDir, snapPath string, rconExec func(string) (string, error)) error {
	worlds := worldDirs(sys, workDir)
	if len(worlds) == 0 {
		return nil
	}

	if _, err := rconExec("save-all flush"); err != nil {
		return fmt.Errorf("world backup: save-all flush: %w", err)
	}
	if _, err := rconExec("save-off"); err != nil {
		return fmt.Errorf("world backup: save-off: %w", err)
	}
	defer func() { _, _ = rconExec("save-on") }()

	for _, name := range worlds {
		// The hardlink snapshot already created snapPath/<world> as a hardlink
		// to the live world. Remove it first so copyWorldDir writes an
		// independent copy rather than layering onto hardlinked data.
		dst := filepath.Join(snapPath, name)
		if err := sys.removeAll(dst); err != nil {
			return fmt.Errorf("world backup: clear %s: %w", name, err)
		}
		if err := copyWorldDir(sys, filepath.Join(workDir, name), dst); err != nil {
			return fmt.Errorf("world backup: copy %s: %w", name, err)
		}
	}
	return nil
}

// restoreWorld replaces world directories in workDir with those from snapPath.
// The live world dir is removed before copying so the restore is a true replace,
// not a merge: copying over an existing dir would leave post-snapshot files
// (new chunks, dug areas) in place and defeat the rollback. Errors are non-fatal
// to callers (they use _ =) but are returned for observability.
func restoreWorld(sys systemOps, workDir, snapPath string) error {
	worlds := worldDirs(sys, snapPath)
	for _, name := range worlds {
		live := filepath.Join(workDir, name)
		if err := sys.removeAll(live); err != nil {
			return fmt.Errorf("world restore: remove %s: %w", name, err)
		}
		if err := copyWorldDir(sys, filepath.Join(snapPath, name), live); err != nil {
			return fmt.Errorf("world restore: copy %s: %w", name, err)
		}
	}
	return nil
}
