package main

import (
	"encoding/json"
	"testing"
	"time"
)

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
