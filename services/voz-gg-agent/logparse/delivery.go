package logparse

import (
	"fmt"
	"strings"
	"time"

	goshared "voz.gg/libs/go-shared"
)

// Backoff configures retry pacing. Base doubles each attempt up to Max; the loop
// gives up after MaxAttempts (0 = retry forever, used by the daemon).
type Backoff struct {
	Base        time.Duration
	Max         time.Duration
	MaxAttempts int
}

// delay returns Base*2^attempt, capped at Max. It doubles iteratively rather
// than shifting by attempt so a long-lived retry-forever loop can never overflow
// int64 and wrap to a negative duration that would slip past the cap.
func (b Backoff) delay(attempt int) time.Duration {
	if b.Base == 0 {
		return 0
	}
	d := b.Base
	for i := 0; i < attempt; i++ {
		next := d << 1
		if next <= 0 { // overflowed
			if b.Max > 0 {
				return b.Max
			}
			return d // no cap configured: hold at the last non-overflowing value
		}
		d = next
		if b.Max > 0 && d >= b.Max {
			return b.Max
		}
	}
	if b.Max > 0 && d > b.Max {
		return b.Max
	}
	return d
}

// presencePath is the events-ingest route, relative to the agent's configured
// ingest base URL (ingest.voz.gg). That host is a dedicated worker, so the path
// needs no extra namespacing.
const presencePath = "/presence"

// Deliverer POSTs presence batches with retry. Transport errors and 5xx are
// retryable; 4xx is permanent (a 400 is malformed events, a 401 a bad token —
// retrying fixes neither).
type Deliverer struct {
	rep     goshared.Reporter
	backoff Backoff
	sleep   func(time.Duration)
}

func NewDeliverer(rep goshared.Reporter, b Backoff) *Deliverer {
	return &Deliverer{rep: rep, backoff: b, sleep: time.Sleep}
}

func (d *Deliverer) Deliver(events []goshared.PresenceEvent) error {
	var result goshared.PresenceResult
	for attempt := 0; ; attempt++ {
		err := d.rep.Post(presencePath, goshared.PresenceBatch{Events: events}, &result)
		if err == nil {
			return nil
		}
		if isPermanent(err) {
			return fmt.Errorf("presence delivery permanently rejected: %w", err)
		}
		if d.backoff.MaxAttempts > 0 && attempt+1 >= d.backoff.MaxAttempts {
			return fmt.Errorf("presence delivery failed after %d attempts: %w", attempt+1, err)
		}
		d.sleep(d.backoff.delay(attempt))
	}
}

// isPermanent reports whether the Reporter error carries a 4xx status that
// re-sending the same batch can never resolve. The Reporter formats non-2xx as
// "post <path>: status <code>: <body>", so we match the "status <code>: " segment
// (with the trailing colon) rather than the bare number, to avoid matching a code
// that merely appears inside a 5xx response body. Only client errors inherent to
// the request are listed; any unlisted status (5xx, transport errors, and
// retryable 4xx such as 429 Too Many Requests) is treated as retryable.
func isPermanent(err error) bool {
	msg := err.Error()
	permanent := []string{
		"status 400: ", // malformed events
		"status 401: ", // bad/expired agent token
		"status 403: ", // forbidden
		"status 404: ", // wrong endpoint
		"status 405: ", // wrong method
		"status 413: ", // batch too large — same payload will always be rejected
		"status 422: ", // unprocessable entity
	}
	for _, code := range permanent {
		if strings.Contains(msg, code) {
			return true
		}
	}
	return false
}
