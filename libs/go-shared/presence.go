package goshared

// Presence wire types mirror libs/shared/src/presence.ts exactly. occurredAt is
// epoch SECONDS (not millis). identityKind and identityKey must be set together
// (both nil for lifecycle events). They deliberately omit `omitempty` so a
// lifecycle event serializes them as explicit null; the optional descriptive
// fields keep `omitempty` so they drop out when unset.
type PresenceEvent struct {
	Type         string  `json:"type"`
	IdentityKind *string `json:"identityKind"`
	IdentityKey  *string `json:"identityKey"`
	PlayerName   *string `json:"playerName,omitempty"`
	IP           *string `json:"ip,omitempty"`
	Reason       *string `json:"reason,omitempty"`
	OccurredAt   int64   `json:"occurredAt"`
}

type PresenceBatch struct {
	Events []PresenceEvent `json:"events"`
}

type PresenceResult struct {
	Accepted int `json:"accepted"`
	Deduped  int `json:"deduped"`
	Rejected int `json:"rejected"`
}

// Presence event types — match PRESENCE_EVENT_TYPES in schema.ts.
const (
	PresenceJoin               = "join"
	PresenceLeave              = "leave"
	PresenceConnectionRejected = "connection_rejected"
	PresenceServerStart        = "server_start"
	PresenceServerStop         = "server_stop"
)

// Identity kinds — match PLAYER_IDENTITY_KINDS in schema.ts.
const (
	IdentityMinecraft = "minecraft"
	IdentitySteam     = "steam"
	IdentityDiscord   = "discord"
)
