package logparse

import (
	"testing"
	"time"
)

func TestResolverConvertsLocalToUTC(t *testing.T) {
	loc := time.FixedZone("UTC+2", 2*3600)
	r := NewTimeResolver(time.Date(2026, 6, 14, 0, 0, 0, 0, loc), loc)
	got, ok := r.Resolve("10:30:12")
	if !ok {
		t.Fatal("expected parse")
	}
	want := time.Date(2026, 6, 14, 10, 30, 12, 0, loc).Unix()
	if got != want {
		t.Fatalf("got %d want %d", got, want)
	}
}

func TestResolverMidnightWrapIncrementsDay(t *testing.T) {
	loc := time.UTC
	r := NewTimeResolver(time.Date(2026, 6, 14, 0, 0, 0, 0, loc), loc)
	first, _ := r.Resolve("23:59:59")
	second, _ := r.Resolve("00:00:01") // wrapped past midnight → next day
	if second <= first {
		t.Fatalf("expected wrap to advance day: first=%d second=%d", first, second)
	}
	if second-first != 2 {
		t.Fatalf("expected 2s gap across midnight, got %d", second-first)
	}
}

func TestResolverRejectsNonTimeLine(t *testing.T) {
	r := NewTimeResolver(time.Date(2026, 6, 14, 0, 0, 0, 0, time.UTC), time.UTC)
	if _, ok := r.Resolve("not a time"); ok {
		t.Fatal("expected failure")
	}
}

func TestResolverRejectsOutOfRange(t *testing.T) {
	r := NewTimeResolver(time.Date(2026, 6, 14, 0, 0, 0, 0, time.UTC), time.UTC)
	for _, in := range []string{"25:00:00", "12:60:00", "12:00:60", "-1:00:00"} {
		if _, ok := r.Resolve(in); ok {
			t.Fatalf("expected %q to be rejected", in)
		}
	}
}

func TestResolverFirstLineDoesNotWrap(t *testing.T) {
	loc := time.UTC
	r := NewTimeResolver(time.Date(2026, 6, 14, 0, 0, 0, 0, loc), loc)
	got, ok := r.Resolve("00:00:01") // a small first value must not advance the day
	if !ok {
		t.Fatal("expected parse")
	}
	if want := time.Date(2026, 6, 14, 0, 0, 1, 0, loc).Unix(); got != want {
		t.Fatalf("first line wrapped the day: got %d want %d", got, want)
	}
}

// A Forge/NeoForge timestamp carries its own date, so it resolves absolutely and
// ignores the anchor day entirely.
func TestResolverParsesNeoForgeAbsoluteTimestamp(t *testing.T) {
	loc := time.UTC
	r := NewTimeResolver(time.Date(2026, 6, 14, 0, 0, 0, 0, loc), loc)
	got, ok := r.Resolve("15May2026 03:51:49.408")
	if !ok {
		t.Fatal("expected NeoForge timestamp to parse")
	}
	if want := time.Date(2026, 5, 15, 3, 51, 49, 0, loc).Unix(); got != want {
		t.Fatalf("got %d want %d (anchor day must be ignored)", got, want)
	}
}

func TestDateFromRolledName(t *testing.T) {
	loc := time.UTC
	got := dateFromRolledName("2026-06-14-3.log.gz", loc)
	want := time.Date(2026, 6, 14, 0, 0, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if z := dateFromRolledName("garbage", loc); !z.IsZero() {
		t.Fatalf("malformed name should yield zero time, got %v", z)
	}
}
