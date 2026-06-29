package main

import (
	"testing"
)

func TestBackupWorldNoWorldsIsNoop(t *testing.T) {
	fs := newFakeUpdSys()
	// No listings → worldDirs returns nil → returns before calling rconExec.
	called := false
	rconExec := func(string) (string, error) { called = true; return "", nil }
	if err := backupWorld(fs, "/srv", "/srv/snapshots/snap-1", rconExec); err != nil {
		t.Fatalf("backupWorld: %v", err)
	}
	if called {
		t.Fatalf("rconExec must not be called when no world dirs exist")
	}
}

func TestBackupWorldQuiescesAndDeepCopies(t *testing.T) {
	fs := newFakeUpdSys()
	fs.listings["/srv"] = []string{"world"}
	fs.files["/srv/world/level.dat"] = []byte("x")
	fs.dirs["/srv/world"] = true
	// Simulate the prior copyTreeHardlink having already created the snapshot
	// world dir as hardlinks to the live world. backupWorld must clear this
	// hardlinked dir before copying, otherwise the backup is not independent.
	fs.dirs["/srv/snapshots/snap-1/world"] = true

	var rconCalls []string
	rconExec := func(cmd string) (string, error) {
		rconCalls = append(rconCalls, cmd)
		return "", nil
	}

	if err := backupWorld(fs, "/srv", "/srv/snapshots/snap-1", rconExec); err != nil {
		t.Fatalf("backupWorld: %v", err)
	}

	// Quiesce order: save-all flush → save-off → (copy) → save-on (deferred).
	if len(rconCalls) != 3 {
		t.Fatalf("want 3 rcon calls, got %v", rconCalls)
	}
	if rconCalls[0] != "save-all flush" {
		t.Fatalf("first rcon call = %q, want save-all flush", rconCalls[0])
	}
	if rconCalls[1] != "save-off" {
		t.Fatalf("second rcon call = %q, want save-off", rconCalls[1])
	}
	if rconCalls[2] != "save-on" {
		t.Fatalf("third rcon call = %q, want save-on", rconCalls[2])
	}

	if len(fs.deepCopies) == 0 {
		t.Fatalf("expected deepCopies when reflinkSupported=false")
	}

	// The snapshot world dir must be cleared (removeAll) before the independent
	// copy is made. Verify both happened and that removeAll preceded the copy.
	const snapWorld = "/srv/snapshots/snap-1/world"
	const copyOp = "deepCopy:/srv/world->/srv/snapshots/snap-1/world"
	removeOp := "removeAll:" + snapWorld
	removeIdx, copyIdx := -1, -1
	for i, op := range fs.ops {
		if op == removeOp {
			removeIdx = i
		}
		if op == copyOp {
			copyIdx = i
		}
	}
	if removeIdx < 0 {
		t.Fatalf("expected removeAll of snapshot world dir %q; ops=%v", snapWorld, fs.ops)
	}
	if copyIdx < 0 {
		t.Fatalf("expected deepCopy of world into snapshot; ops=%v", fs.ops)
	}
	if removeIdx >= copyIdx {
		t.Fatalf("removeAll (idx %d) must precede deepCopy (idx %d); ops=%v", removeIdx, copyIdx, fs.ops)
	}
}

func TestBackupWorldUsesReflinkWhenSupported(t *testing.T) {
	fs := newFakeUpdSys()
	fs.reflinkSupported = true
	fs.listings["/srv"] = []string{"world"}
	fs.files["/srv/world/level.dat"] = []byte("x")
	fs.dirs["/srv/world"] = true

	if err := backupWorld(fs, "/srv", "/srv/snapshots/snap-1", func(string) (string, error) { return "", nil }); err != nil {
		t.Fatalf("backupWorld: %v", err)
	}

	if len(fs.reflinkCopies) == 0 {
		t.Fatalf("expected reflinkCopies when reflinkSupported=true")
	}
	if len(fs.deepCopies) != 0 {
		t.Fatalf("unexpected deepCopies when reflink is available: %v", fs.deepCopies)
	}
}

func TestRestoreWorldCopiesBack(t *testing.T) {
	fs := newFakeUpdSys()
	snapPath := "/srv/snapshots/snap-1"
	fs.listings[snapPath] = []string{"world"}
	fs.files[snapPath+"/world/level.dat"] = []byte("x")
	fs.dirs[snapPath+"/world"] = true

	if err := restoreWorld(fs, "/srv", snapPath); err != nil {
		t.Fatalf("restoreWorld: %v", err)
	}

	want := snapPath + "/world->/srv/world"
	found := false
	for _, c := range fs.deepCopies {
		if c == want {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected deepCopy %q, got %v", want, fs.deepCopies)
	}

	// The live world dir must be removed before the copy, so a restore replaces
	// rather than merges (post-snapshot files must not survive).
	removed := false
	for _, p := range fs.removedPaths {
		if p == "/srv/world" {
			removed = true
		}
	}
	if !removed {
		t.Fatalf("expected live world dir /srv/world to be removed, got %v", fs.removedPaths)
	}
}
