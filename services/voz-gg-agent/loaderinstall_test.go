package main

import (
	"fmt"
	"testing"
	"time"
)

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
