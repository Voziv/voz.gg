package goshared

import "testing"

func TestNewEventSetsType(t *testing.T) {
	e := NewEvent(EventPlayerJoin, "alice")
	if e.Type != EventPlayerJoin {
		t.Fatalf("got type %q, want %q", e.Type, EventPlayerJoin)
	}
	if e.Subject != "alice" {
		t.Fatalf("got subject %q, want %q", e.Subject, "alice")
	}
}
