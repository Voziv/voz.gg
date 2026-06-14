package logparse

import "testing"

func TestParseLineMappings(t *testing.T) {
	p := NewCorrelator()
	// UUID binding produces no event but populates the map.
	if ev, ok := p.Parse(`UUID of player Steve is f498b235-9a85-4a5e-9f12-f47eb3a73e9b`); ok {
		t.Fatalf("uuid binding should not emit an event, got %+v", ev)
	}
	join, ok := p.Parse(`Steve joined the game`)
	if !ok || join.Type != "join" || join.PlayerName != "Steve" ||
		join.IdentityKey != "f498b2359a854a5e9f12f47eb3a73e9b" {
		t.Fatalf("join: %+v ok=%v", join, ok)
	}
	leave, ok := p.Parse(`Steve left the game`)
	if !ok || leave.Type != "leave" || leave.IdentityKey != "f498b2359a854a5e9f12f47eb3a73e9b" {
		t.Fatalf("leave should reuse last-known uuid: %+v", leave)
	}
}

func TestJoinWithoutUUIDHasEmptyKey(t *testing.T) {
	p := NewCorrelator()
	join, ok := p.Parse(`Alex joined the game`)
	if !ok || join.Type != "join" || join.IdentityKey != "" {
		t.Fatalf("unseen uuid should yield empty key: %+v", join)
	}
}

func TestConnectionRejectedWhitelist(t *testing.T) {
	p := NewCorrelator()
	ev, ok := p.Parse(`com.mojang.authlib.GameProfile@1[id=f498b235-9a85-4a5e-9f12-f47eb3a73e9b,name=BadGuy,properties={},legacy=false] (/192.0.2.1:51234) lost connection: You are not white-listed on this server!`)
	if !ok || ev.Type != "connection_rejected" || ev.PlayerName != "BadGuy" ||
		ev.IP != "192.0.2.1" || ev.Reason != "whitelist" ||
		ev.IdentityKey != "f498b2359a854a5e9f12f47eb3a73e9b" {
		t.Fatalf("rejected: %+v ok=%v", ev, ok)
	}
}

func TestConnectionRejectedRawReason(t *testing.T) {
	p := NewCorrelator()
	ev, ok := p.Parse(`GameProfile[id=f498b235-9a85-4a5e-9f12-f47eb3a73e9b,name=Foo,properties={}] (/192.0.2.9:1234) lost connection: Disconnected`)
	if !ok || ev.Reason != "Disconnected" {
		t.Fatalf("rejected: %+v ok=%v", ev, ok)
	}
}

func TestLifecycleLines(t *testing.T) {
	p := NewCorrelator()
	start, ok := p.Parse(`Done (12.345s)! For help, type "help"`)
	if !ok || start.Type != "server_start" {
		t.Fatalf("start: %+v", start)
	}
	stop, ok := p.Parse(`Stopping the server`)
	if !ok || stop.Type != "server_stop" {
		t.Fatalf("stop: %+v", stop)
	}
}

func TestIgnoredLine(t *testing.T) {
	p := NewCorrelator()
	if _, ok := p.Parse(`Preparing spawn area: 42%`); ok {
		t.Fatal("noise line should not emit an event")
	}
}

func TestChatLineIsNotAJoin(t *testing.T) {
	p := NewCorrelator()
	if _, ok := p.Parse(`<Alice> joined the game`); ok {
		t.Fatal("a chat message must not be parsed as a join event")
	}
	if _, ok := p.Parse(`<Bob> left the game`); ok {
		t.Fatal("a chat message must not be parsed as a leave event")
	}
}
