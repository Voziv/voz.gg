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
	// Matches both "com.mojang.authlib.GameProfile@N[id=..,name=..]" and bare
	// "GameProfile[id=..,name=..]" rejection lines: "...(/<ip>:<port>) lost connection: <reason>".
	rejectRe = regexp.MustCompile(`id=([0-9a-fA-F-]{32,36}),name=([^,\]]+).*?\(/([^:]+):\d+\) lost connection: (.+)$`)
	startRe  = regexp.MustCompile(`^Done \(.*\)! For help, type`)
)

const stopMessage = "Stopping the server"

// dashlessUUID lowercases and strips dashes so keys match the ingest's identity_key.
func dashlessUUID(s string) string {
	return strings.ToLower(strings.ReplaceAll(s, "-", ""))
}

// Correlator parses lines and holds a short-lived name→UUID map so a join/leave
// can be attributed to the UUID announced on the preceding "UUID of player" line.
type Correlator struct {
	nameToUUID map[string]string
}

func NewCorrelator() *Correlator {
	return &Correlator{nameToUUID: map[string]string{}}
}

// Parse returns the event for a message body and true, or (zero, false) for
// lines that carry no event (UUID bindings and noise).
func (c *Correlator) Parse(msg string) (ParsedLine, bool) {
	msg = strings.TrimSpace(msg)

	if m := uuidBindRe.FindStringSubmatch(msg); m != nil {
		c.nameToUUID[m[1]] = dashlessUUID(m[2])
		return ParsedLine{}, false
	}
	if m := joinRe.FindStringSubmatch(msg); m != nil {
		return ParsedLine{Type: "join", PlayerName: m[1], IdentityKey: c.nameToUUID[m[1]]}, true
	}
	if m := leaveRe.FindStringSubmatch(msg); m != nil {
		return ParsedLine{Type: "leave", PlayerName: m[1], IdentityKey: c.nameToUUID[m[1]]}, true
	}
	if m := rejectRe.FindStringSubmatch(msg); m != nil {
		reason := strings.TrimSpace(m[4])
		if strings.Contains(strings.ToLower(reason), "not white-listed") {
			reason = "whitelist"
		}
		return ParsedLine{
			Type: "connection_rejected", PlayerName: m[2],
			IdentityKey: dashlessUUID(m[1]), IP: m[3], Reason: reason,
		}, true
	}
	if startRe.MatchString(msg) {
		return ParsedLine{Type: "server_start"}, true
	}
	if msg == stopMessage {
		return ParsedLine{Type: "server_stop"}, true
	}
	return ParsedLine{}, false
}

// linePrefixRe requires a leading "[HH:MM:SS]" (so date-stamped lines never
// match), consumes the optional "[thread/LEVEL]:" tag, and captures the rest as
// the message body.
var linePrefixRe = regexp.MustCompile(`^\[(\d{2}:\d{2}:\d{2})\][^:]*:?\s*(.*)$`)

// SplitLine separates the "[HH:MM:SS]" timestamp from the message body, dropping
// the thread/level tag. It returns ok=false for any line not prefixed with a
// bracketed HH:MM:SS timestamp.
func SplitLine(line string) (timestamp, body string, ok bool) {
	m := linePrefixRe.FindStringSubmatch(line)
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}
