package logparse

import (
	"path/filepath"
	"time"

	goshared "voz.gg/libs/go-shared"
)

// Runner ties the source, parser, and deliverer together. Backfill processes
// rolled logs then latest.log from the saved offset, delivering events in
// chunks of BatchSize and advancing the checkpoint only after each file's
// events are acked.
type Runner struct {
	Source     *Source
	Deliverer  *Deliverer
	Checkpoint string
	BatchSize  int
	Location   *time.Location
	AnchorDate time.Time // anchor for latest.log's day; rolled logs use their filename date
}

func ptr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// toEvent converts a ParsedLine + epoch second to a wire event, pairing the
// identity fields (both set for a minecraft UUID, both nil otherwise).
func toEvent(p ParsedLine, occurredAt int64) goshared.PresenceEvent {
	e := goshared.PresenceEvent{
		Type:       p.Type,
		PlayerName: ptr(p.PlayerName),
		IP:         ptr(p.IP),
		Reason:     ptr(p.Reason),
		OccurredAt: occurredAt,
	}
	if p.IdentityKey != "" {
		kind := goshared.IdentityMinecraft
		e.IdentityKind = &kind
		e.IdentityKey = ptr(p.IdentityKey)
	}
	return e
}

func (r *Runner) Backfill() error {
	files, err := r.Source.RolledThenLatest()
	if err != nil {
		return err
	}
	checkpoint, err := LoadCheckpoint(r.Checkpoint)
	if err != nil {
		return err
	}

	for _, path := range files {
		if err := r.processFile(path, checkpoint); err != nil {
			return err
		}
	}
	return nil
}

const defaultBatchSize = 200

// processFile reads one log file, delivering its events in BatchSize chunks, and
// (for latest.log) advances the checkpoint to the final offset once all of the
// file's events are acked.
func (r *Runner) processFile(path string, checkpoint Checkpoint) error {
	isLatest := filepath.Base(path) == LatestLog
	startOffset := int64(0)
	if isLatest && checkpoint.File == LatestLog {
		startOffset = checkpoint.Offset
	}
	anchor := r.AnchorDate
	if !isLatest {
		anchor = dateFromRolledName(filepath.Base(path), r.Location)
	}
	// Guard against a misconfigured zero/negative BatchSize, which would otherwise
	// flush one HTTP POST per event. The ingest also caps a batch at 1000 events.
	batchSize := r.BatchSize
	if batchSize <= 0 {
		batchSize = defaultBatchSize
	}
	correlator := NewCorrelator()
	resolver := NewTimeResolver(anchor, r.Location)

	var batch []goshared.PresenceEvent
	var deliverErr error
	deliver := func() {
		if len(batch) == 0 || deliverErr != nil {
			return
		}
		if err := r.Deliverer.Deliver(batch); err != nil {
			deliverErr = err
			return
		}
		batch = batch[:0]
	}

	offset, readErr := r.Source.ReadLines(path, startOffset, func(line string) {
		if deliverErr != nil {
			return
		}
		ts, body, ok := SplitLine(line)
		if !ok {
			return
		}
		event, ok := correlator.Parse(body)
		if !ok {
			return
		}
		occurredAt, ok := resolver.Resolve(ts)
		if !ok {
			return
		}
		batch = append(batch, toEvent(event, occurredAt))
		if len(batch) >= batchSize {
			deliver()
		}
	})
	if readErr != nil {
		return readErr
	}
	if deliverErr != nil {
		return deliverErr
	}
	deliver() // final partial batch
	if deliverErr != nil {
		return deliverErr
	}
	if isLatest {
		return SaveCheckpoint(r.Checkpoint, Checkpoint{File: LatestLog, Offset: offset})
	}
	return nil
}
