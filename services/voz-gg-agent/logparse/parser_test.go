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

func TestSplitLine(t *testing.T) {
	ts, body, ok := SplitLine(`[10:30:12] [Server thread/INFO]: Steve joined the game`)
	if !ok || ts != "10:30:12" || body != "Steve joined the game" {
		t.Fatalf("got ts=%q body=%q ok=%v", ts, body, ok)
	}
}

func TestSplitLineNoBracket(t *testing.T) {
	if _, _, ok := SplitLine(`garbage without timestamp`); ok {
		t.Fatal("expected failure on non-timestamped line")
	}
}

func TestSplitLinePreservesColonsInBody(t *testing.T) {
	ts, body, ok := SplitLine(`[11:02:47] [User Authenticator #1/INFO]: GameProfile[id=x] (/1.2.3.4:5) lost connection: nope`)
	if !ok || ts != "11:02:47" || body != "GameProfile[id=x] (/1.2.3.4:5) lost connection: nope" {
		t.Fatalf("got ts=%q body=%q ok=%v", ts, body, ok)
	}
}

func TestSplitLineEmptyBody(t *testing.T) {
	ts, body, ok := SplitLine(`[10:30:12] [Server thread/INFO]: `)
	if !ok || ts != "10:30:12" || body != "" {
		t.Fatalf("got ts=%q body=%q ok=%v", ts, body, ok)
	}
}

func TestSplitLineRejectsDateStampedLine(t *testing.T) {
	if _, _, ok := SplitLine(`[2024-01-15 10:30:00] [INFO] some property line`); ok {
		t.Fatal("a date-stamped line must not be treated as an HH:MM:SS log line")
	}
}

// Forge/NeoForge lines carry a full "[ddMMMyyyy HH:mm:ss.SSS]" timestamp and an
// extra "[logger]" bracket before the body; SplitLine must strip both and keep
// the body (including its own colons) intact.
func TestSplitLineNeoForge(t *testing.T) {
	ts, body, ok := SplitLine(`[15May2026 03:51:49.408] [Server thread/INFO] [net.minecraft.server.network.ServerLoginPacketListenerImpl/]: mori6 (/193.32.248.156:42080) lost connection: Disconnected`)
	if !ok || ts != "15May2026 03:51:49.408" || body != "mori6 (/193.32.248.156:42080) lost connection: Disconnected" {
		t.Fatalf("got ts=%q body=%q ok=%v", ts, body, ok)
	}
}

func TestNeoForgeJoinCorrelatesUUID(t *testing.T) {
	p := NewCorrelator()
	if _, ok := p.Parse(`UUID of player tunestay is e4f45465-c071-4e5e-b844-e342804c8315`); ok {
		t.Fatal("uuid binding should not emit an event")
	}
	join, ok := p.Parse(`tunestay joined the game`)
	if !ok || join.Type != "join" || join.IdentityKey != "e4f45465c0714e5eb844e342804c8315" {
		t.Fatalf("join: %+v ok=%v", join, ok)
	}
}

// A modern rejection has no inline UUID; it is recovered from the preceding
// "UUID of player" line and the whitelist reason is normalized.
func TestNeoForgeWhitelistRejection(t *testing.T) {
	p := NewCorrelator()
	p.Parse(`UUID of player tunestay is e4f45465-c071-4e5e-b844-e342804c8315`)
	ev, ok := p.Parse(`tunestay (/51.159.119.214:59980) lost connection: You are not white-listed on this server!`)
	if !ok || ev.Type != "connection_rejected" || ev.PlayerName != "tunestay" ||
		ev.IP != "51.159.119.214" || ev.Reason != "whitelist" ||
		ev.IdentityKey != "e4f45465c0714e5eb844e342804c8315" {
		t.Fatalf("rejected: %+v ok=%v", ev, ok)
	}
}

// A joined player's "lost connection" is the tail of a normal session (its leave
// comes from "left the game"), so it must not surface as a rejection.
func TestOnlinePlayerDisconnectSuppressed(t *testing.T) {
	p := NewCorrelator()
	p.Parse(`UUID of player Steve is f498b235-9a85-4a5e-9f12-f47eb3a73e9b`)
	p.Parse(`Steve joined the game`)
	if ev, ok := p.Parse(`Steve (/10.0.0.5:5000) lost connection: Disconnected`); ok {
		t.Fatalf("online player's disconnect must be suppressed, got %+v", ev)
	}
	leave, ok := p.Parse(`Steve left the game`)
	if !ok || leave.Type != "leave" || leave.IdentityKey != "f498b2359a854a5e9f12f47eb3a73e9b" {
		t.Fatalf("leave: %+v ok=%v", leave, ok)
	}
}

// A disconnect with no preceding UUID line is an anonymous pre-auth scan; it
// carries no identity and would only add noise, so it is dropped.
func TestAnonymousScanDisconnectSuppressed(t *testing.T) {
	p := NewCorrelator()
	if ev, ok := p.Parse(`mori6 (/193.32.248.156:42080) lost connection: Disconnected`); ok {
		t.Fatalf("anonymous disconnect must be suppressed, got %+v", ev)
	}
}
