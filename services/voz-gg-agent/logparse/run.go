package logparse

import (
	"context"
	"errors"
	"io/fs"
	"os"
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

	// correlator carries name→UUID and online-player state across every file in a
	// run so sessions are detected across log-file boundaries. Lazily created and
	// reused for the Runner's lifetime; never reset between files or poll ticks.
	correlator *Correlator
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

// PollLatest processes only latest.log from the saved checkpoint. Used by the
// tail loop so rolled logs (already handled by the initial Backfill) are not
// re-read on every tick. A missing latest.log is a no-op.
func (r *Runner) PollLatest() error {
	path := filepath.Join(r.Source.dir, LatestLog)
	if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	checkpoint, err := LoadCheckpoint(r.Checkpoint)
	if err != nil {
		return err
	}
	return r.processFile(path, checkpoint)
}

// Tail backfills rolled + latest.log once, then re-reads latest.log on each tick
// until ctx is cancelled. Any error from PollLatest is returned immediately and
// ends the loop; callers wanting retry-forever delivery should give the Deliverer
// a Backoff with MaxAttempts = 0, so only permanent errors (a 4xx or a
// file-system failure) escape — leaving the process supervisor to restart.
func (r *Runner) Tail(ctx context.Context, interval time.Duration) error {
	if err := r.Backfill(); err != nil {
		return err
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := r.PollLatest(); err != nil {
				return err
			}
		}
	}
}

const (
	defaultBatchSize = 200
	// maxBatchSize mirrors the ingest's per-request cap (parsePresenceBody's
	// .max(1000)); a larger batch would be rejected wholesale as a 400.
	maxBatchSize = 1000
)

// processFile reads one log file, delivering its events in BatchSize chunks, and
// (for latest.log) advances the checkpoint to the final offset once all of the
// file's events are acked.
func (r *Runner) processFile(path string, checkpoint Checkpoint) error {
	isLatest := filepath.Base(path) == LatestLog
	startOffset := int64(0)
	if isLatest && checkpoint.File == LatestLog {
		startOffset = checkpoint.Offset
		// Detect rotation/truncation: when the server restarts, log4j2 rolls
		// latest.log to a dated .gz and starts a fresh, shorter file. A stale
		// offset would seek past the new session's head and silently skip it, so
		// restart from the beginning when the file is now smaller than the offset.
		if info, err := os.Stat(path); err == nil && info.Size() < startOffset {
			startOffset = 0
		}
	}
	anchor := r.AnchorDate
	if !isLatest {
		anchor = dateFromRolledName(filepath.Base(path), r.Location)
	}
	// Clamp BatchSize into (0, maxBatchSize]: a zero/negative value would flush one
	// POST per event; a value above the ingest cap would have the whole batch rejected.
	batchSize := r.BatchSize
	if batchSize <= 0 {
		batchSize = defaultBatchSize
	}
	if batchSize > maxBatchSize {
		batchSize = maxBatchSize
	}
	if r.correlator == nil {
		r.correlator = NewCorrelator()
	}
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
		event, ok := r.correlator.Parse(body)
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
