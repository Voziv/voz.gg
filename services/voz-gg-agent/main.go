// Command voz-gg-agent is the co-located voz.gg host agent. It runs as one of
// several capability subcommands; `monitor` probes the local game server and
// reports status to the Worker, re-pulling config on hash change.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"voz.gg/services/voz-gg-agent/prober"
)

// version is injected at build time via -ldflags "-X main.version=<v>",
// sourced from the project's VERSION file. It defaults to "dev" for local builds.
var version = "dev"

const defaultConfigPath = "/etc/voz-gg-agent/monitor.json"

func main() {
	os.Exit(dispatch(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func usage(w io.Writer) {
	fmt.Fprintln(w, "usage: voz-gg-agent <command> [flags]")
	fmt.Fprintln(w, "commands:")
	fmt.Fprintln(w, "  monitor       probe the local game server and report status")
	fmt.Fprintln(w, "  setup         enroll, create the voz-gg service user, and install the hardened unit")
	fmt.Fprintln(w, "  logparse      parse the game-server log and report player presence")
	fmt.Fprintln(w, "  write-config  read an enroll response from stdin and write the monitor config")
	fmt.Fprintln(w, "  version       print the version")
}

// dispatch routes a command line to a subcommand and returns the process exit
// code. Kept separate from main() so routing is unit-testable without building
// the binary or touching the real process.
func dispatch(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		usage(stderr)
		return 2
	}
	switch args[0] {
	case "version", "-version", "--version":
		fmt.Fprintln(stdout, version)
		return 0
	case "help", "-h", "--help":
		usage(stdout)
		return 0
	case "monitor":
		return runMonitor(args[1:], stderr)
	case "setup":
		return runSetup(args[1:], stdout, stderr)
	case "write-config":
		return runWriteConfig(args[1:], stdin, stderr)
	case "logparse":
		return runLogparse(args[1:], stderr)
	default:
		fmt.Fprintf(stderr, "unknown command %q\n", args[0])
		usage(stderr)
		return 2
	}
}

func runMonitor(args []string, stderr io.Writer) int {
	fs := flag.NewFlagSet("monitor", flag.ContinueOnError)
	fs.SetOutput(stderr)
	configPath := fs.String("config", defaultConfigPath, "path to the monitor config json")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(stderr, "load config %s: %v\n", *configPath, err)
		return 1
	}

	agent := &Agent{
		Config:      cfg,
		Client:      &http.Client{Timeout: 10 * time.Second},
		ProberForFn: prober.For,
		ConfigPath:  *configPath,
	}
	run(context.Background(), agent)
	return 0
}

func runWriteConfig(args []string, stdin io.Reader, stderr io.Writer) int {
	fs := flag.NewFlagSet("write-config", flag.ContinueOnError)
	fs.SetOutput(stderr)
	configPath := fs.String("config", defaultConfigPath, "path to write the monitor config json")
	workerBaseURL := fs.String("worker-base-url", "", "worker base URL to embed in the config")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}

	cfg, err := ConfigFromEnroll(stdin, *workerBaseURL)
	if err != nil {
		fmt.Fprintf(stderr, "write-config: %v\n", err)
		return 1
	}
	if err := SaveConfig(*configPath, cfg); err != nil {
		fmt.Fprintf(stderr, "write-config: %v\n", err)
		return 1
	}
	return 0
}

func run(ctx context.Context, agent *Agent) {
	for {
		if err := agent.RunCycle(ctx); err != nil {
			log.Printf("cycle error (retrying next interval): %v", err)
		}
		interval := agent.Config.Server.PollIntervalSeconds
		if interval <= 0 {
			interval = 30
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(interval) * time.Second):
		}
	}
}
