package main

import (
	"testing"

	goshared "voz.gg/libs/go-shared"
)

func TestStatusEventUsesSharedLib(t *testing.T) {
	e := statusEvent("mc.example.com")
	if e.Type != goshared.EventPlayerJoin {
		// The stub reuses an existing event type purely to exercise the import.
		t.Fatalf("unexpected event type %q", e.Type)
	}
	if e.Subject != "mc.example.com" {
		t.Fatalf("got subject %q, want host", e.Subject)
	}
}
