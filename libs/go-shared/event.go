// Package goshared holds types and helpers shared by voz.gg Go services and tools.
package goshared

type EventType string

const (
	EventPlayerJoin  EventType = "player_join"
	EventPlayerLeave EventType = "player_leave"
)

type Event struct {
	Type    EventType `json:"type"`
	Subject string    `json:"subject"`
}

func NewEvent(t EventType, subject string) Event {
	return Event{Type: t, Subject: subject}
}
