package main

import (
	"encoding/json"
	"testing"
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
