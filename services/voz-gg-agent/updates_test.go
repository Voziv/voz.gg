package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

type fakeUpdSys struct {
	files            map[string][]byte
	dirs             map[string]bool
	links            map[string]string
	ran              []string
	downloads        map[string]int64 // url -> size written
	hashByPath       map[string]string
	reflinkCopies    []string
	deepCopies       []string
	reflinkSupported bool
	listings         map[string][]string
	removedPaths     []string
}

func newFakeUpdSys() *fakeUpdSys {
	return &fakeUpdSys{
		files:      map[string][]byte{},
		dirs:       map[string]bool{},
		links:      map[string]string{},
		downloads:  map[string]int64{},
		hashByPath: map[string]string{},
		listings:   map[string][]string{},
	}
}

func (f *fakeUpdSys) hasSystemd() bool                  { return true }
func (f *fakeUpdSys) mkdirAll(p string, _ uint32) error { f.dirs[p] = true; return nil }
func (f *fakeUpdSys) writeFile(p string, d []byte, _ uint32) error {
	f.files[p] = d
	return nil
}
func (f *fakeUpdSys) readFile(p string) ([]byte, error) {
	if d, ok := f.files[p]; ok {
		return d, nil
	}
	return nil, os.ErrNotExist
}
func (f *fakeUpdSys) pathExists(p string) bool {
	if _, ok := f.files[p]; ok {
		return true
	}
	return f.dirs[p]
}
func (f *fakeUpdSys) symlink(target, link string) error { f.links[link] = target; return nil }
func (f *fakeUpdSys) readlink(p string) (string, error) {
	if t, ok := f.links[p]; ok {
		return t, nil
	}
	return "", os.ErrNotExist
}
func (f *fakeUpdSys) downloadTo(url, dest string) (int64, error) {
	n := f.downloads[url]
	f.files[dest] = make([]byte, n)
	return n, nil
}
func (f *fakeUpdSys) hashFile(p, _ string) (string, error)   { return f.hashByPath[p], nil }
func (f *fakeUpdSys) copyTreeHardlink(src, dst string) error { f.dirs[dst] = true; return nil }
func (f *fakeUpdSys) removeAll(p string) error {
	delete(f.dirs, p)
	delete(f.files, p)
	f.removedPaths = append(f.removedPaths, p)
	return nil
}
func (f *fakeUpdSys) listDir(p string) ([]string, error)  { return f.listings[p], nil }
func (f *fakeUpdSys) chownRecursive(_, _, _ string) error { return nil }
func (f *fakeUpdSys) run(name string, args ...string) error {
	f.ran = append(f.ran, name+" "+strings.Join(args, " "))
	return nil
}
func (f *fakeUpdSys) groupExists(string) bool               { return true }
func (f *fakeUpdSys) userExists(string) bool                { return true }
func (f *fakeUpdSys) createSystemGroup(string) error        { return nil }
func (f *fakeUpdSys) createSystemUser(string, string) error { return nil }
func (f *fakeUpdSys) unitInstalled(string) bool             { return true }
func (f *fakeUpdSys) remove(string) error                   { return nil }
func (f *fakeUpdSys) rename(string, string) error           { return nil }
func (f *fakeUpdSys) binaryVersion(string) (string, error)  { return "", nil }
func (f *fakeUpdSys) reExec(string, []string) error         { return nil }
func (f *fakeUpdSys) runIn(string, string, ...string) error { return nil }
func (f *fakeUpdSys) reflinkCopy(src, dst string) (bool, error) {
	if f.reflinkSupported {
		f.reflinkCopies = append(f.reflinkCopies, src+"->"+dst)
		f.dirs[dst] = true
		return true, nil
	}
	return false, nil
}
func (f *fakeUpdSys) copyTreeDeep(src, dst string) error {
	f.deepCopies = append(f.deepCopies, src+"->"+dst)
	f.dirs[dst] = true
	return nil
}

func TestUpdatesCapabilityDecode(t *testing.T) {
	raw := `{"enabled":true,"policy":"auto","desired":{"id":"apply:1.21.4","kind":"apply","version":"1.21.4","artifact":{"url":"https://x/server.jar","hashAlgo":"sha1","hash":"abc","size":54321},"snapshotId":""}}`
	var cap updatesCapability
	if err := json.Unmarshal([]byte(raw), &cap); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !cap.Enabled || cap.Policy != "auto" || cap.Desired == nil {
		t.Fatalf("unexpected: %+v", cap)
	}
	if cap.Desired.Artifact == nil || cap.Desired.Artifact.Size != 54321 || cap.Desired.Artifact.Hash != "abc" {
		t.Fatalf("artifact: %+v", cap.Desired.Artifact)
	}
}

func TestParseOnlinePlayers(t *testing.T) {
	n, ok := parseOnlinePlayers("There are 0 of a max of 20 players online:")
	if !ok || n != 0 {
		t.Fatalf("got %d %v", n, ok)
	}
	n, ok = parseOnlinePlayers("There are 3 of a max of 20 players online: a, b, c")
	if !ok || n != 3 {
		t.Fatalf("got %d %v", n, ok)
	}
	if _, ok := parseOnlinePlayers("garbage"); ok {
		t.Fatalf("expected parse failure")
	}
}

func TestWithinRestartWindow(t *testing.T) {
	at := func(h, m int) time.Time { return time.Date(2026, 6, 27, h, m, 0, 0, time.UTC) }
	if !withinRestartWindow(at(4, 5), "04:00", 15) {
		t.Fatalf("04:05 should be inside the 04:00+15m window")
	}
	if withinRestartWindow(at(4, 20), "04:00", 15) {
		t.Fatalf("04:20 should be outside")
	}
	if withinRestartWindow(at(4, 5), "", 15) {
		t.Fatalf("empty schedule is never a window")
	}
}

func TestShouldApplyNow(t *testing.T) {
	now := time.Date(2026, 6, 27, 12, 0, 0, 0, time.UTC)
	if !shouldApplyNow(triggerGate{Empty: true, KnownEmpty: true, Now: now, Schedule: "04:00"}) {
		t.Fatalf("empty server should apply")
	}
	if shouldApplyNow(triggerGate{Empty: false, KnownEmpty: true, Now: now, Schedule: "04:00"}) {
		t.Fatalf("non-empty outside window should defer")
	}
	winNow := time.Date(2026, 6, 27, 4, 5, 0, 0, time.UTC)
	if !shouldApplyNow(triggerGate{Empty: false, KnownEmpty: true, Now: winNow, Schedule: "04:00"}) {
		t.Fatalf("non-empty inside window should force apply")
	}
	if shouldApplyNow(triggerGate{Empty: false, KnownEmpty: false, Now: now, Schedule: "04:00"}) {
		t.Fatalf("unknown emptiness outside window must not apply")
	}
}

func TestPlanReconcile(t *testing.T) {
	apply := &desiredRelease{ID: "apply:1.21.4", Kind: "apply", Version: "1.21.4"}
	if planReconcile("1.21.1", apply, "").Kind != "apply" {
		t.Fatalf("should plan apply")
	}
	if planReconcile("1.21.4", apply, "").Kind != "none" {
		t.Fatalf("installed==target should be none")
	}
	if planReconcile("1.21.1", apply, "apply:1.21.4").Kind != "none" {
		t.Fatalf("already-handled id should be none")
	}
	rb := &desiredRelease{ID: "rollback:snap-1", Kind: "rollback", SnapshotID: "snap-1"}
	if planReconcile("1.21.4", rb, "").Kind != "rollback" {
		t.Fatalf("should plan rollback")
	}
	if planReconcile("1.21.4", rb, "rollback:snap-1").Kind != "none" {
		t.Fatalf("handled rollback should be none")
	}
	if planReconcile("1.21.4", nil, "").Kind != "none" {
		t.Fatalf("nil desired is none")
	}
}

func TestSnapshotIDAndPaths(t *testing.T) {
	id := snapshotID(time.Date(2026, 6, 27, 4, 0, 0, 0, time.UTC), "1.21.1")
	if id != "2026-06-27T040000Z-pre-1.21.1" {
		t.Fatalf("id = %q", id)
	}
	if releaseDir("/srv/s", "1.21.4") != "/srv/s/releases/1.21.4" {
		t.Fatalf("releaseDir wrong")
	}
	if currentLink("/srv/s") != "/srv/s/current" {
		t.Fatalf("currentLink wrong")
	}
}

func TestSnapshotsToPrune(t *testing.T) {
	existing := []string{
		"2026-06-20T040000Z-pre-1.20",
		"2026-06-21T040000Z-pre-1.21",
		"2026-06-22T040000Z-pre-1.21.1",
		"2026-06-23T040000Z-pre-1.21.2",
	}
	prune := snapshotsToPrune(existing, 3)
	if len(prune) != 1 || prune[0] != "2026-06-20T040000Z-pre-1.20" {
		t.Fatalf("prune = %v", prune)
	}
	if len(snapshotsToPrune(existing, 4)) != 0 {
		t.Fatalf("nothing to prune when keep>=len")
	}
}

func TestApplyUpdateHappyPath(t *testing.T) {
	sys := newFakeUpdSys()
	url := "https://x/server.jar"
	sys.downloads[url] = 100
	jarPath := "/srv/s/releases/1.21.4/server.jar"
	sys.hashByPath[jarPath] = "abc"
	sys.links["/srv/s/current"] = "/srv/s/releases/1.21.1"

	out, err := applyUpdate(applyDeps{
		sys:     sys,
		now:     func() time.Time { return time.Date(2026, 6, 27, 4, 0, 0, 0, time.UTC) },
		workDir: "/srv/s", slug: "s", serverUser: "mc",
		desired: &desiredRelease{ID: "apply:1.21.4", Kind: "apply", Version: "1.21.4",
			Artifact: &desiredArtifact{URL: url, HashAlgo: "sha1", Hash: "abc", Size: 100}},
		installed:   "1.21.1",
		healthCheck: func() error { return nil },
		rconWarn:    func(string) {},
	})
	if err != nil {
		t.Fatalf("apply err: %v", err)
	}
	if out.Status != "success" || out.To != "1.21.4" || out.From != "1.21.1" {
		t.Fatalf("outcome: %+v", out)
	}
	if sys.links["/srv/s/current"] != "/srv/s/releases/1.21.4" {
		t.Fatalf("current not repointed: %v", sys.links)
	}
}

func TestApplyUpdateHashMismatchAborts(t *testing.T) {
	sys := newFakeUpdSys()
	url := "https://x/server.jar"
	sys.downloads[url] = 100
	sys.hashByPath["/srv/s/releases/1.21.4/server.jar"] = "WRONG"
	sys.links["/srv/s/current"] = "/srv/s/releases/1.21.1"
	out, err := applyUpdate(applyDeps{
		sys: sys, now: func() time.Time { return time.Now().UTC() },
		workDir: "/srv/s", slug: "s", serverUser: "mc",
		desired: &desiredRelease{ID: "apply:1.21.4", Kind: "apply", Version: "1.21.4",
			Artifact: &desiredArtifact{URL: url, HashAlgo: "sha1", Hash: "abc", Size: 100}},
		installed: "1.21.1", healthCheck: func() error { return nil }, rconWarn: func(string) {},
	})
	if err == nil && out.Status != "failed" {
		t.Fatalf("expected failure on hash mismatch, got %+v / %v", out, err)
	}
	if sys.links["/srv/s/current"] != "/srv/s/releases/1.21.1" {
		t.Fatalf("current must not move on hash mismatch")
	}
}

func TestApplyUpdateFailedBootReverts(t *testing.T) {
	sys := newFakeUpdSys()
	url := "https://x/server.jar"
	sys.downloads[url] = 100
	sys.hashByPath["/srv/s/releases/1.21.4/server.jar"] = "abc"
	sys.links["/srv/s/current"] = "/srv/s/releases/1.21.1"
	out, _ := applyUpdate(applyDeps{
		sys: sys, now: func() time.Time { return time.Date(2026, 6, 27, 4, 0, 0, 0, time.UTC) },
		workDir: "/srv/s", slug: "s", serverUser: "mc",
		desired: &desiredRelease{ID: "apply:1.21.4", Kind: "apply", Version: "1.21.4",
			Artifact: &desiredArtifact{URL: url, HashAlgo: "sha1", Hash: "abc", Size: 100}},
		installed:   "1.21.1",
		healthCheck: func() error { return errors.New("never came up") },
		rconWarn:    func(string) {},
	})
	if out.Kind != "auto_revert" || out.Status != "failed" {
		t.Fatalf("expected auto_revert/failed, got %+v", out)
	}
	if sys.links["/srv/s/current"] != "/srv/s/releases/1.21.1" {
		t.Fatalf("auto-revert must restore the old current symlink")
	}
}

func TestRollbackRestoresSnapshot(t *testing.T) {
	sys := newFakeUpdSys()
	snap := "2026-06-20T040000Z-pre-1.21.1"
	sys.dirs["/srv/s/snapshots/"+snap] = true
	sys.links["/srv/s/snapshots/"+snap+"/current"] = "/srv/s/releases/1.21.1"
	sys.links["/srv/s/current"] = "/srv/s/releases/1.21.4"
	out, err := rollbackUpdate(applyDeps{
		sys: sys, now: func() time.Time { return time.Now().UTC() },
		workDir: "/srv/s", slug: "s", serverUser: "mc",
		desired:     &desiredRelease{ID: "rollback:" + snap, Kind: "rollback", SnapshotID: snap},
		installed:   "1.21.4",
		healthCheck: func() error { return nil }, rconWarn: func(string) {},
	})
	if err != nil || out.Kind != "rollback" || out.Status != "success" {
		t.Fatalf("rollback outcome %+v err %v", out, err)
	}
	if sys.links["/srv/s/current"] != "/srv/s/releases/1.21.1" {
		t.Fatalf("current not restored to the snapshot's release: %v", sys.links)
	}
}

func TestRollbackMissingSnapshotFails(t *testing.T) {
	sys := newFakeUpdSys()
	out, err := rollbackUpdate(applyDeps{
		sys: sys, now: func() time.Time { return time.Now().UTC() },
		workDir: "/srv/s", slug: "s", serverUser: "mc",
		desired:     &desiredRelease{ID: "rollback:nope", Kind: "rollback", SnapshotID: "nope"},
		installed:   "1.21.4",
		healthCheck: func() error { return nil }, rconWarn: func(string) {},
	})
	if err == nil || out.Status != "failed" {
		t.Fatalf("expected failure for missing snapshot, got %+v / %v", out, err)
	}
}

func TestAdoptIdentifiesAndMovesJar(t *testing.T) {
	sys := newFakeUpdSys()
	jar := buildJar(t, `{"id":"1.21.1"}`)
	sys.files["/srv/s/server.jar"] = jar
	out, err := adoptLayout(adoptDeps{
		sys: sys, now: func() time.Time { return time.Date(2026, 6, 27, 4, 0, 0, 0, time.UTC) },
		workDir: "/srv/s", slug: "s", serverUser: "mc",
		openJar: func(p string) (io.ReaderAt, int64, error) {
			d := sys.files[p]
			return bytes.NewReader(d), int64(len(d)), nil
		},
	})
	if err != nil {
		t.Fatalf("adopt err: %v", err)
	}
	if out.To != "1.21.1" {
		t.Fatalf("adopted version = %q", out.To)
	}
	if sys.links["/srv/s/current"] != "/srv/s/releases/1.21.1" {
		t.Fatalf("current not created: %v", sys.links)
	}
}

func TestReconcileUpdatesInstallAndRemove(t *testing.T) {
	sys := newFakeUpdSys()
	var buf bytes.Buffer
	sc := serverControlCapability{Enabled: true, Slug: "s", WorkingDir: "/srv/s"}
	if err := reconcileUpdates(sys, updatesCapability{Enabled: true}, sc, "/usr/local/bin/voz-gg-agent", "/etc/voz-gg-agent/monitor.json", &buf); err != nil {
		t.Fatalf("install: %v", err)
	}
	if _, ok := sys.files["/etc/systemd/system/voz-gg-agent-updates.timer"]; !ok {
		t.Fatalf("timer not written")
	}
	if err := reconcileUpdates(sys, updatesCapability{Enabled: false}, sc, "x", "y", &buf); err != nil {
		t.Fatalf("remove: %v", err)
	}
}

func TestParseSnapshotName(t *testing.T) {
	now := func() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) }
	createdAt, version := parseSnapshotName("2026-06-27T040000Z-pre-1.21.1", now)
	if version != "1.21.1" {
		t.Fatalf("version = %q", version)
	}
	if createdAt != "2026-06-27T04:00:00Z" {
		t.Fatalf("createdAt = %q", createdAt)
	}
}
