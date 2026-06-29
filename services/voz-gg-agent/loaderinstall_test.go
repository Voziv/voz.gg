package main

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

var fixedNow = func() time.Time { return time.Unix(1750000000, 0).UTC() }

const loaderInstallerURL = "https://x/installer.jar"
const loaderInstallerPath = "/srv/.updates-tmp/installer.jar"
const neoforgeMarkerPath = "/srv/releases/21.1.234.staging/libraries/net/neoforged/neoforge/21.1.234/unix_args.txt"
const neoforgeReleasePath = "/srv/releases/21.1.234"

func loaderApplyDeps(fs *fakeUpdSys) applyDeps {
	return applyDeps{
		sys: fs, now: func() time.Time { return time.Unix(1750000000, 0).UTC() },
		workDir: "/srv", slug: "srv", serverUser: "minecraft",
		desired: &desiredRelease{
			ID: "apply:21.1.234", Kind: "apply", Version: "21.1.234",
			Artifact: &desiredArtifact{URL: loaderInstallerURL, HashAlgo: "sha256", Hash: "good", Size: 1},
			Install:  &desiredInstall{Loader: "neoforge", MinecraftVersion: "1.21.1", LoaderVersion: "21.1.234"},
		},
		installed:   "21.1.200",
		healthCheck: func() error { return nil },
		rconWarn:    func(string) {},
		rconExec:    func(string) (string, error) { return "", nil },
		jvmArgs:     "-Xmx4G",
		execPath:    "/usr/local/bin/voz-gg-agent",
		configPath:  "/etc/voz-gg-agent/monitor.json",
	}
}

func TestInstallLoaderHappyPath(t *testing.T) {
	fs := newFakeUpdSys()
	fs.downloads[loaderInstallerURL] = 1
	fs.hashByPath[loaderInstallerPath] = "good"
	fs.files[neoforgeMarkerPath] = []byte("x") // simulate successful staged install

	out, err := installLoader(loaderApplyDeps(fs))
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != "success" || out.To != "21.1.234" {
		t.Fatalf("bad outcome %+v", out)
	}
	if !fs.renamedTo(neoforgeReleasePath) {
		t.Fatalf("expected promote to release dir; renames=%v", fs.renames)
	}
	if !fs.symlinked("/srv/libraries") {
		t.Fatalf("expected libraries bridge symlink; links=%v", fs.links)
	}
}

func TestInstallLoaderHashMismatchAborts(t *testing.T) {
	fs := newFakeUpdSys()
	fs.downloads[loaderInstallerURL] = 1
	fs.hashByPath[loaderInstallerPath] = "bad" // mismatches artifact Hash:"good"

	out, _ := installLoader(loaderApplyDeps(fs))
	if out.Status != "failed" {
		t.Fatal("expected failure on hash mismatch")
	}
	if fs.renamedTo(neoforgeReleasePath) {
		t.Fatal("must not promote to release dir on hash mismatch")
	}
}

func TestInstallLoaderMissingMarkerAborts(t *testing.T) {
	fs := newFakeUpdSys()
	fs.downloads[loaderInstallerURL] = 1
	fs.hashByPath[loaderInstallerPath] = "good"
	// marker not seeded → staged tree lacks unix_args.txt

	out, _ := installLoader(loaderApplyDeps(fs))
	if out.Status != "failed" {
		t.Fatal("expected failure when staged install is missing markers")
	}
	if fs.renamedTo(neoforgeReleasePath) {
		t.Fatal("must not promote to release dir on a partial install")
	}
}

func TestInstallLoaderFailedBootReverts(t *testing.T) {
	fs := newFakeUpdSys()
	fs.downloads[loaderInstallerURL] = 1
	fs.hashByPath[loaderInstallerPath] = "good"
	fs.files[neoforgeMarkerPath] = []byte("x")
	// Prior state to revert to: current symlink + an existing game unit file.
	fs.links["/srv/current"] = "/srv/releases/21.1.200"
	unitFile := "/etc/systemd/system/voz-gg-srv.service"
	priorUnit := []byte("prior-unit-execstart")
	fs.files[unitFile] = priorUnit

	deps := loaderApplyDeps(fs)
	deps.healthCheck = func() error { return fmt.Errorf("boot failed") }
	out, _ := installLoader(deps)

	if out.Kind != "auto_revert" || out.Status != "failed" {
		t.Fatalf("expected auto_revert/failed, got %+v", out)
	}
	if fs.links["/srv/current"] != "/srv/releases/21.1.200" {
		t.Fatalf("current must be restored to prior target; links=%v", fs.links)
	}
	if string(fs.files[unitFile]) != string(priorUnit) {
		t.Fatalf("prior unit ExecStart not restored; got %q", fs.files[unitFile])
	}
}

// TestAdoptLoaderNeoforgeMatch verifies that a neoforge flat install is adopted
// at the on-disk version when the listing contains a matching unix_args.txt path.
func TestAdoptLoaderNeoforgeMatch(t *testing.T) {
	fs := newFakeUpdSys()
	fs.walk["/srv"] = []string{"run.sh", "libraries/net/neoforged/neoforge/21.1.234/unix_args.txt"}
	inst := &desiredInstall{Loader: "neoforge", MinecraftVersion: "1.21.1", LoaderVersion: "21.1.234"}
	out, err := adoptLoaderLayout(
		adoptDeps{sys: fs, now: fixedNow, workDir: "/srv", slug: "srv", serverUser: "minecraft"},
		inst, "", "/bin/agent", "/etc/cfg",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Status != "success" || out.To != "21.1.234" {
		t.Fatalf("bad adopt outcome: %+v", out)
	}
	if !fs.symlinked("/srv/current") {
		t.Fatalf("expected current symlink; links=%v", fs.links)
	}
	if !fs.symlinked("/srv/libraries") {
		t.Fatalf("expected libraries bridge symlink; links=%v", fs.links)
	}
}

// TestAdoptLoaderOlderOnDiskAdopts verifies that when the on-disk version is
// older than the Worker-declared desired version, adoption still succeeds at
// the on-disk version. The loader TYPE is the cross-check, not the version.
func TestAdoptLoaderOlderOnDiskAdopts(t *testing.T) {
	fs := newFakeUpdSys()
	fs.walk["/srv"] = []string{"libraries/net/neoforged/neoforge/21.1.200/unix_args.txt"}
	inst := &desiredInstall{Loader: "neoforge", MinecraftVersion: "1.21.1", LoaderVersion: "21.1.234"}
	out, err := adoptLoaderLayout(
		adoptDeps{sys: fs, now: fixedNow, workDir: "/srv", slug: "srv", serverUser: "minecraft"},
		inst, "", "/bin/agent", "/etc/cfg",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Status != "success" || out.To != "21.1.200" {
		t.Fatalf("expected success with on-disk version 21.1.200; got %+v", out)
	}
	unit := string(fs.files["/etc/systemd/system/voz-gg-srv.service"])
	if !strings.Contains(unit, "21.1.200") {
		t.Fatalf("unit ExecStart must reference the on-disk version; got %q", unit)
	}
	if strings.Contains(unit, "21.1.234") {
		t.Fatalf("unit ExecStart must not reference the desired version; got %q", unit)
	}
}

// TestAdoptLoaderFabric verifies fabric adoption: the on-disk version is not
// recoverable, so adoption succeeds at the Worker-declared loader version once a
// fabric launch jar is confirmed present.
func TestAdoptLoaderFabric(t *testing.T) {
	fs := newFakeUpdSys()
	fs.walk["/srv"] = []string{
		"libraries/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar",
		"fabric-server-launch.jar",
		"fabric-server-launcher.properties",
	}
	inst := &desiredInstall{Loader: "fabric", MinecraftVersion: "1.21.1", LoaderVersion: "0.16.9"}
	out, err := adoptLoaderLayout(
		adoptDeps{sys: fs, now: fixedNow, workDir: "/srv", slug: "srv", serverUser: "minecraft"},
		inst, "", "/bin/agent", "/etc/cfg",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Status != "success" || out.To != "0.16.9" {
		t.Fatalf("expected fabric success at declared version 0.16.9; got %+v", out)
	}
	if !fs.symlinked("/srv/current") {
		t.Fatalf("expected current symlink; links=%v", fs.links)
	}
}

// TestAdoptLoaderWrongLoaderAborts verifies that when the flat install contains
// no recognisable loader artifacts (e.g. just a vanilla server.jar), adoption
// aborts with a failed outcome and touches nothing.
func TestAdoptLoaderWrongLoaderAborts(t *testing.T) {
	fs := newFakeUpdSys()
	fs.walk["/srv"] = []string{"server.jar"}
	inst := &desiredInstall{Loader: "neoforge", MinecraftVersion: "1.21.1", LoaderVersion: "21.1.234"}
	out, err := adoptLoaderLayout(
		adoptDeps{sys: fs, now: fixedNow, workDir: "/srv", slug: "srv", serverUser: "minecraft"},
		inst, "", "/bin/agent", "/etc/cfg",
	)
	if err == nil || out.Status != "failed" {
		t.Fatalf("expected failed outcome for unparseable install; got %+v err %v", out, err)
	}
	if fs.symlinked("/srv/current") {
		t.Fatalf("adoption must not touch the install on abort; links=%v", fs.links)
	}
}

// TestRollbackRewritesLoaderExecStart verifies that a manual rollback rewrites
// the game-unit ExecStart to match the rolled-back release. For a loader server
// the ExecStart embeds a version-specific path; without this fix the old unit
// (referencing the now-absent release) would leave the server unbootable.
func TestRollbackRewritesLoaderExecStart(t *testing.T) {
	fs := newFakeUpdSys()
	snap := "2026-06-20T040000Z-pre-21.1.234"
	snapPath := "/srv/snapshots/" + snap

	// Snapshot exists and its current link points to the older 21.1.200 release.
	fs.dirs[snapPath] = true
	fs.links[snapPath+"/current"] = "/srv/releases/21.1.200"

	// Live install is 21.1.234; the unit file still references it.
	fs.links["/srv/current"] = "/srv/releases/21.1.234"
	unitFile := "/etc/systemd/system/voz-gg-srv.service"
	fs.files[unitFile] = []byte("ExecStart=java -Xmx4G @current/libraries/net/neoforged/neoforge/21.1.234/unix_args.txt nogui")

	// After repointing current → 21.1.200, detectInstalledLoader walks that dir
	// and finds the neoforge 21.1.200 marker.
	fs.walk["/srv/releases/21.1.200"] = []string{
		"libraries/net/neoforged/neoforge/21.1.200/unix_args.txt",
	}

	out, err := rollbackUpdate(applyDeps{
		sys: fs, now: func() time.Time { return time.Now().UTC() },
		workDir: "/srv", slug: "srv", serverUser: "minecraft",
		desired:     &desiredRelease{ID: "rollback:" + snap, Kind: "rollback", SnapshotID: snap},
		installed:   "21.1.234",
		healthCheck: func() error { return nil },
		rconWarn:    func(string) {},
		jvmArgs:     "-Xmx4G",
		execPath:    "/usr/local/bin/voz-gg-agent",
		configPath:  "/etc/voz-gg-agent/monitor.json",
	})
	if err != nil || out.Kind != "rollback" || out.Status != "success" {
		t.Fatalf("rollback outcome %+v err %v", out, err)
	}

	unit := string(fs.files[unitFile])
	if !strings.Contains(unit, "21.1.200") {
		t.Fatalf("unit file must reference rolled-back version 21.1.200; got %q", unit)
	}
	if strings.Contains(unit, "21.1.234") {
		t.Fatalf("unit file must not reference stale version 21.1.234 after rollback; got %q", unit)
	}
}
