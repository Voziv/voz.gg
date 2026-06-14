package goshared

import (
	"encoding/json"
	"testing"
)

func strptr(s string) *string { return &s }

func TestPresenceEventMarshalsContractShape(t *testing.T) {
	e := PresenceEvent{
		Type:         PresenceJoin,
		IdentityKind: strptr(IdentityMinecraft),
		IdentityKey:  strptr("f498b2359a854a5e9f12f47eb3a73e9b"),
		PlayerName:   strptr("Steve"),
		OccurredAt:   1781344800,
	}
	raw, err := json.Marshal(PresenceBatch{Events: []PresenceEvent{e}})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	ev := got["events"].([]any)[0].(map[string]any)
	if ev["type"] != "join" || ev["identityKind"] != "minecraft" ||
		ev["identityKey"] != "f498b2359a854a5e9f12f47eb3a73e9b" ||
		ev["playerName"] != "Steve" || ev["occurredAt"].(float64) != 1781344800 {
		t.Fatalf("unexpected shape: %s", raw)
	}
	if _, ok := ev["ip"]; ok {
		t.Fatalf("nil ip should be omitted/null, got present non-null: %s", raw)
	}
}

func TestLifecycleEventHasNullIdentity(t *testing.T) {
	raw, err := json.Marshal(PresenceEvent{Type: PresenceServerStart, OccurredAt: 1781344795})
	if err != nil {
		t.Fatal(err)
	}
	var ev map[string]any
	if err := json.Unmarshal(raw, &ev); err != nil {
		t.Fatal(err)
	}
	if ev["identityKind"] != nil || ev["identityKey"] != nil {
		t.Fatalf("lifecycle event must have null identity: %s", raw)
	}
}

func TestPresenceResultUnmarshals(t *testing.T) {
	var r PresenceResult
	if err := json.Unmarshal([]byte(`{"accepted":5,"deduped":2,"rejected":1}`), &r); err != nil {
		t.Fatal(err)
	}
	if r.Accepted != 5 || r.Deduped != 2 || r.Rejected != 1 {
		t.Fatalf("got %+v", r)
	}
}
