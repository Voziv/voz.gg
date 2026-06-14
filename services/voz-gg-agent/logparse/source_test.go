package logparse

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

func writeGz(t *testing.T, path, content string) {
	t.Helper()
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	gw.Write([]byte(content))
	gw.Close()
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestListLogsChronological(t *testing.T) {
	dir := t.TempDir()
	writeGz(t, filepath.Join(dir, "2026-06-13-1.log.gz"), "a\n")
	writeGz(t, filepath.Join(dir, "2026-06-14-1.log.gz"), "b\n")
	writeGz(t, filepath.Join(dir, "2026-06-14-2.log.gz"), "c\n")
	if err := os.WriteFile(filepath.Join(dir, "latest.log"), []byte("d\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	src := NewSource(dir)
	files, err := src.RolledThenLatest()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"2026-06-13-1.log.gz", "2026-06-14-1.log.gz", "2026-06-14-2.log.gz", "latest.log"}
	if len(files) != len(want) {
		t.Fatalf("got %v", files)
	}
	for i := range want {
		if filepath.Base(files[i]) != want[i] {
			t.Fatalf("at %d got %s want %s", i, filepath.Base(files[i]), want[i])
		}
	}
}

func TestReadLinesGzip(t *testing.T) {
	dir := t.TempDir()
	writeGz(t, filepath.Join(dir, "2026-06-14-1.log.gz"), "line1\nline2\n")
	src := NewSource(dir)
	var lines []string
	_, err := src.ReadLines(filepath.Join(dir, "2026-06-14-1.log.gz"), 0, func(l string) { lines = append(lines, l) })
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 || lines[0] != "line1" || lines[1] != "line2" {
		t.Fatalf("got %v", lines)
	}
}

func TestReadLinesFromOffsetReturnsNewBytes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "latest.log")
	if err := os.WriteFile(path, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	src := NewSource(dir)
	off, _ := src.ReadLines(path, 0, func(string) {})
	if err := os.WriteFile(path, []byte("old\nnew\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var lines []string
	newOff, err := src.ReadLines(path, off, func(l string) { lines = append(lines, l) })
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 1 || lines[0] != "new" || newOff <= off {
		t.Fatalf("got lines=%v off=%d newOff=%d", lines, off, newOff)
	}
}

func TestReadLinesIndexOrderingDoubleDigit(t *testing.T) {
	dir := t.TempDir()
	writeGz(t, filepath.Join(dir, "2026-06-14-2.log.gz"), "x\n")
	writeGz(t, filepath.Join(dir, "2026-06-14-10.log.gz"), "y\n")
	src := NewSource(dir)
	files, err := src.RolledThenLatest()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(files[0]) != "2026-06-14-2.log.gz" || filepath.Base(files[1]) != "2026-06-14-10.log.gz" {
		t.Fatalf("index 2 must sort before 10: got %v", files)
	}
}
