package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	goshared "voz.gg/libs/go-shared"
	"voz.gg/services/voz-gg-agent/logparse"
)

func runLogparse(args []string, stderr io.Writer) int {
	fs := flag.NewFlagSet("logparse", flag.ContinueOnError)
	fs.SetOutput(stderr)
	configPath := fs.String("config", defaultConfigPath, "path to the agent config json")
	logDir := fs.String("log-dir", "", "Minecraft server log directory (contains latest.log)")
	checkpoint := fs.String("checkpoint", "", "checkpoint file path (default <log-dir>/.voz-logparse-checkpoint.json)")
	backfillOnly := fs.Bool("backfill-only", false, "process history once and exit")
	batchSize := fs.Int("batch-size", 200, "max events per POST")
	flushSeconds := fs.Int("flush-seconds", 5, "tail re-read interval seconds")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if *logDir == "" {
		fmt.Fprintln(stderr, "logparse: -log-dir is required")
		return 2
	}
	cfg, err := LoadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(stderr, "logparse: load config %s: %v\n", *configPath, err)
		return 1
	}
	cp := *checkpoint
	if cp == "" {
		cp = filepath.Join(*logDir, ".voz-logparse-checkpoint.json")
	}

	rep := goshared.Reporter{
		Endpoint: cfg.WorkerBaseURL,
		Token:    cfg.AgentToken,
		Client:   &http.Client{Timeout: 15 * time.Second},
	}
	runner := &logparse.Runner{
		Source: logparse.NewSource(*logDir),
		// Backoff has no MaxAttempts, so delivery retries forever (at-least-once);
		// only a permanent 4xx ends a poll.
		Deliverer:  logparse.NewDeliverer(rep, logparse.Backoff{Base: time.Second, Max: 30 * time.Second}),
		Checkpoint: cp,
		BatchSize:  *batchSize,
		Location:   time.Local,
		AnchorDate: time.Now(),
	}

	if *backfillOnly {
		if err := runner.Backfill(); err != nil {
			fmt.Fprintf(stderr, "logparse: %v\n", err)
			return 1
		}
		return 0
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := runner.Tail(ctx, time.Duration(*flushSeconds)*time.Second); err != nil {
		fmt.Fprintf(stderr, "logparse: %v\n", err)
		return 1
	}
	return 0
}
