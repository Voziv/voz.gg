package main

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

const testExecPath = "/usr/local/bin/voz-gg-agent"

func fakeDownload(data []byte, err error) downloadFn {
	return func(string) ([]byte, error) { return data, err }
}

func updateOpts() updateOptions {
	return updateOptions{
		URL:            "https://example/voz-gg-agent-linux-amd64",
		ExecPath:       testExecPath,
		ConfigPath:     "/etc/voz-gg-agent/monitor.json",
		CurrentVersion: "1.0.0",
	}
}

func reExecRequestsReconcile(args []string) bool {
	var sawSubcommand, sawFlag bool
	for _, a := range args {
		if a == "update" {
			sawSubcommand = true
		}
		if a == "--reconcile-only" {
			sawFlag = true
		}
	}
	return sawSubcommand && sawFlag
}

func TestUpdateSwapsNewerBinaryThenReExecsReconcile(t *testing.T) {
	sys := newFakeSystem()
	sys.downloadedVersion = "1.4.0"
	var out, errb bytes.Buffer

	code := runUpdateWith(updateOpts(), sys, fakeDownload([]byte("NEW-BINARY"), nil), &out, &errb)
	if code != 0 {
		t.Fatalf("exit = %d (stderr=%q)", code, errb.String())
	}
	if got := string(sys.files[testExecPath]); got != "NEW-BINARY" {
		t.Fatalf("binary not swapped in: %q", got)
	}
	if sys.filePerms[testExecPath] != 0o755 {
		t.Fatalf("binary perms = %o, want 755", sys.filePerms[testExecPath])
	}
	if _, ok := sys.files[testExecPath+".new"]; ok {
		t.Fatal("temp file should have been renamed away")
	}
	if !sys.reExeced || !reExecRequestsReconcile(sys.reExecArgs) {
		t.Fatalf("did not re-exec into reconcile: reExeced=%v args=%v", sys.reExeced, sys.reExecArgs)
	}
	// Phase one must not restart units itself; the re-exec'd phase two does.
	if len(sys.runs) != 0 {
		t.Fatalf("phase one should not run systemctl: %v", sys.runs)
	}
}

func TestUpdateSkipsSwapWhenAlreadyLatestButStillReExecs(t *testing.T) {
	sys := newFakeSystem()
	sys.downloadedVersion = "1.0.0" // same as CurrentVersion
	sys.files[testExecPath] = []byte("OLD-BINARY")
	var out, errb bytes.Buffer

	code := runUpdateWith(updateOpts(), sys, fakeDownload([]byte("SAME"), nil), &out, &errb)
	if code != 0 {
		t.Fatalf("exit = %d (stderr=%q)", code, errb.String())
	}
	if got := string(sys.files[testExecPath]); got != "OLD-BINARY" {
		t.Fatalf("binary should be unchanged when already latest: %q", got)
	}
	if _, ok := sys.files[testExecPath+".new"]; ok {
		t.Fatal("temp file should have been removed")
	}
	if !sys.reExeced {
		t.Fatal("should still re-exec to reconcile config even when binary is current")
	}
}

func TestUpdateDownloadFailureDoesNotReExec(t *testing.T) {
	sys := newFakeSystem()
	sys.files[testExecPath] = []byte("OLD-BINARY")

	code := runUpdateWith(updateOpts(), sys, fakeDownload(nil, errSentinel), &bytes.Buffer{}, &bytes.Buffer{})
	if code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
	if got := string(sys.files[testExecPath]); got != "OLD-BINARY" {
		t.Fatalf("binary changed on failed download: %q", got)
	}
	if sys.reExeced {
		t.Fatal("must not re-exec on a failed download")
	}
}

func TestUpdateVersionReadFailureLeavesBinaryUntouched(t *testing.T) {
	sys := newFakeSystem()
	sys.files[testExecPath] = []byte("OLD-BINARY")
	sys.versionErr = errSentinel

	code := runUpdateWith(updateOpts(), sys, fakeDownload([]byte("CORRUPT"), nil), &bytes.Buffer{}, &bytes.Buffer{})
	if code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
	if got := string(sys.files[testExecPath]); got != "OLD-BINARY" {
		t.Fatalf("binary swapped despite unreadable version: %q", got)
	}
	if sys.reExeced {
		t.Fatal("must not re-exec when the downloaded binary is unusable")
	}
}

func TestUpdateReExecFailureReturns1(t *testing.T) {
	sys := newFakeSystem()
	sys.downloadedVersion = "1.4.0"
	sys.reExecErr = errSentinel

	code := runUpdateWith(updateOpts(), sys, fakeDownload([]byte("NEW"), nil), &bytes.Buffer{}, &bytes.Buffer{})
	if code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
}

// --- phase two: reconcile ---------------------------------------------------

func reconcileOpts() reconcileOptions {
	return reconcileOptions{
		ConfigPath: "/etc/voz-gg-agent/monitor.json",
		ExecPath:   testExecPath,
		OpenTTY: func() (io.ReadWriteCloser, error) {
			panic("reconcile test must not prompt")
		},
	}
}

func fakeLoad(cfg Config, err error) func(string) (Config, error) {
	return func(string) (Config, error) { return cfg, err }
}

func TestReconcileWithKeyRefreshesConfigAndReconciles(t *testing.T) {
	sys := newFakeSystem()
	sys.units[monitorUnitName] = true
	save, saved := reprovisionSave()
	var out, errb bytes.Buffer

	code := runReconcileWith(reconcileOpts(), sys, fakeProvision(sampleEnroll(), nil),
		fakeLoad(existingConfig(), nil), func(_ string, c Config) error { return save(c) }, &out, &errb)
	if code != 0 {
		t.Fatalf("exit = %d (stderr=%q)", code, errb.String())
	}
	if saved.ConfigHash != "H1" || saved.AgentToken != "AT-existing" {
		t.Fatalf("config not refreshed without rotating token: %+v", saved)
	}
	if !hasRun(sys.runs, "systemctl", "restart", monitorUnitName) {
		t.Fatalf("monitor not restarted: %v", sys.runs)
	}
}

func TestReconcileWithoutKeyRestartsUnitsOnly(t *testing.T) {
	sys := newFakeSystem()
	sys.units[monitorUnitName] = true
	sys.units[logparseUnitName] = true
	noKey := Config{WorkerBaseURL: "https://voz.gg", AgentToken: ""}
	fetched := false
	fetch := func(string, string) (enrollResponse, error) { fetched = true; return enrollResponse{}, nil }
	var out bytes.Buffer

	code := runReconcileWith(reconcileOpts(), sys, fetch, fakeLoad(noKey, nil),
		func(string, Config) error { return nil }, &out, &bytes.Buffer{})
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if fetched {
		t.Fatal("must not fetch provisioning without a key")
	}
	if !hasRun(sys.runs, "systemctl", "restart", monitorUnitName) || !hasRun(sys.runs, "systemctl", "restart", logparseUnitName) {
		t.Fatalf("installed units not restarted: %v", sys.runs)
	}
}

func TestReconcileWithoutConfigRestartsUnitsOnly(t *testing.T) {
	sys := newFakeSystem()
	sys.units[monitorUnitName] = true
	var out bytes.Buffer

	code := runReconcileWith(reconcileOpts(), sys, fakeProvision(sampleEnroll(), nil),
		fakeLoad(Config{}, errSentinel), func(string, Config) error { return nil }, &out, &bytes.Buffer{})
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if !hasRun(sys.runs, "systemctl", "restart", monitorUnitName) {
		t.Fatalf("monitor not restarted: %v", sys.runs)
	}
	if !strings.Contains(out.String(), "no config") {
		t.Fatalf("expected a no-config notice, got %q", out.String())
	}
}
