// Package logparse turns Minecraft (Java) server-log lines into presence events.
package logparse

import (
	"regexp"
	"strings"
)

// ParsedLine is a presence event recognized from one log line, before a
// timestamp is attached. IdentityKey is the 32-hex (no-dash) Minecraft UUID, or
// "" when unknown / not applicable.
type ParsedLine struct {
	Type        string
	PlayerName  string
	IdentityKey string
	IP          string
	Reason      string
}

var (
	uuidBindRe = regexp.MustCompile(`UUID of player (\S+) is ([0-9a-fA-F-]{32,36})`)
	joinRe     = regexp.MustCompile(`^([A-Za-z0-9_]{1,16}) joined the game$`)
	leaveRe    = regexp.MustCompile(`^([A-Za-z0-9_]{1,16}) left the game$`)
	// rejectProfileRe matches the GameProfile disconnect form carrying an inline
	// UUID — "com.mojang.authlib.GameProfile@N[id=..,name=..]" or bare
	// "GameProfile[id=..,name=..]" — "...(/<ip>:<port>) lost connection: <reason>".
	rejectProfileRe = regexp.MustCompile(`id=([0-9a-fA-F-]{32,36}),name=([^,\]]+).*?\(/([^:]+):\d+\) lost connection: (.+)$`)
	// rejectSimpleRe matches the modern Forge/NeoForge form, which carries no
	// inline UUID: "<name> (/<ip>:<port>) lost connection: <reason>". The UUID, if
	// the connection authenticated, is recovered from the preceding "UUID of
	// player" line via the correlator.
	rejectSimpleRe = regexp.MustCompile(`^(\S+) \(/([^:]+):\d+\) lost connection: (.+)$`)
	startRe        = regexp.MustCompile(`^Done \(.*\)! For help, type`)
)

const stopMessage = "Stopping the server"

// dashlessUUID lowercases and strips dashes so keys match the ingest's identity_key.
func dashlessUUID(s string) string {
	return strings.ToLower(strings.ReplaceAll(s, "-", ""))
}

// Correlator parses lines and carries the cross-line state a single line lacks:
// a name→UUID map (so a join/leave/rejection can be attributed to the UUID from
// an earlier "UUID of player" line) and the set of currently-online names (so a
// disconnect can be told apart from a login rejection). A single Correlator is
// shared across a whole backfill run so this state survives log-file boundaries —
// a player whose UUID was announced in a rolled log is still attributed when they
// join in latest.log.
type Correlator struct {
	nameToUUID map[string]string
	online     map[string]bool
}

func NewCorrelator() *Correlator {
	return &Correlator{nameToUUID: map[string]string{}, online: map[string]bool{}}
}

// Parse returns the event for a message body and true, or (zero, false) for
// lines that carry no event (UUID bindings, suppressed disconnects, and noise).
func (c *Correlator) Parse(msg string) (ParsedLine, bool) {
	msg = strings.TrimSpace(msg)

	if m := uuidBindRe.FindStringSubmatch(msg); m != nil {
		c.nameToUUID[m[1]] = dashlessUUID(m[2])
		return ParsedLine{}, false
	}
	if m := joinRe.FindStringSubmatch(msg); m != nil {
		c.online[m[1]] = true
		return ParsedLine{Type: "join", PlayerName: m[1], IdentityKey: c.nameToUUID[m[1]]}, true
	}
	if m := leaveRe.FindStringSubmatch(msg); m != nil {
		delete(c.online, m[1])
		return ParsedLine{Type: "leave", PlayerName: m[1], IdentityKey: c.nameToUUID[m[1]]}, true
	}
	if matched, ev, emit := c.classifyDisconnect(msg); matched {
		return ev, emit
	}
	if startRe.MatchString(msg) {
		c.online = map[string]bool{} // a (re)start means everyone is disconnected
		return ParsedLine{Type: "server_start"}, true
	}
	if msg == stopMessage {
		c.online = map[string]bool{}
		return ParsedLine{Type: "server_stop"}, true
	}
	return ParsedLine{}, false
}

// classifyDisconnect handles "lost connection" lines. matched reports whether the
// line is a disconnect at all; when matched, emit reports whether it should
// surface as a connection_rejected event. Two matched cases are deliberately
// suppressed: a disconnect from a player who is currently online is the tail of a
// normal session (its leave is already emitted by "left the game"), and a
// disconnect with no resolved UUID is an anonymous pre-auth scan (no identity to
// attribute, and high-volume noise).
func (c *Correlator) classifyDisconnect(msg string) (matched bool, ev ParsedLine, emit bool) {
	var name, identity, ip, reason string
	if m := rejectProfileRe.FindStringSubmatch(msg); m != nil {
		identity, name, ip, reason = dashlessUUID(m[1]), m[2], m[3], m[4]
	} else if m := rejectSimpleRe.FindStringSubmatch(msg); m != nil {
		name, ip, reason = m[1], m[2], m[3]
		identity = c.nameToUUID[name]
	} else {
		return false, ParsedLine{}, false
	}

	if c.online[name] || identity == "" {
		return true, ParsedLine{}, false
	}
	reason = strings.TrimSpace(reason)
	if strings.Contains(strings.ToLower(reason), "not white-listed") {
		reason = "whitelist"
	}
	return true, ParsedLine{
		Type: "connection_rejected", PlayerName: name,
		IdentityKey: identity, IP: ip, Reason: reason,
	}, true
}

// linePrefixRe matches either log timestamp format and captures the message
// body. Vanilla/Paper uses a bare "[HH:MM:SS]"; Forge/NeoForge uses a full
// "[ddMMMyyyy HH:mm:ss.SSS]" followed by extra "[thread/LEVEL] [logger]" tags.
// "[^:]*" consumes those bracket tags up to the "]: " before the body (the
// timestamp's own colons sit inside the captured "[...]"), and "(.*)" keeps any
// colons within the body. A date-stamped property line ("[YYYY-MM-DD HH:MM:SS]")
// matches neither timestamp alternative and is rejected.
var linePrefixRe = regexp.MustCompile(`^\[(\d{2}:\d{2}:\d{2}|\d{2}[A-Za-z]{3}\d{4} \d{2}:\d{2}:\d{2}\.\d{3})\][^:]*:?\s*(.*)$`)

// SplitLine separates the leading "[timestamp]" from the message body, dropping
// any thread/level/logger tags. The timestamp is either "HH:MM:SS" (vanilla) or
// "ddMMMyyyy HH:mm:ss.SSS" (Forge/NeoForge); the resolver handles both. It
// returns ok=false for any line not prefixed with a recognized bracketed timestamp.
func SplitLine(line string) (timestamp, body string, ok bool) {
	m := linePrefixRe.FindStringSubmatch(line)
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}
