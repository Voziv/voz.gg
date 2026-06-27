package main

import (
	"archive/zip"
	"bytes"
	"testing"
)

func buildJar(t *testing.T, versionJSON string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("version.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte(versionJSON)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestJarVersion(t *testing.T) {
	jar := buildJar(t, `{"id":"1.21.4","name":"1.21.4"}`)
	v, err := jarVersion(bytes.NewReader(jar), int64(len(jar)))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if v != "1.21.4" {
		t.Fatalf("v = %q", v)
	}
}

func TestJarVersionMissing(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	zw.Close()
	if _, err := jarVersion(bytes.NewReader(buf.Bytes()), int64(buf.Len())); err == nil {
		t.Fatalf("expected error for jar without version.json")
	}
}
