// Command status-monitor is the co-located voz.gg agent. It probes the local
// game server and reports status to the Worker, re-pulling config on hash change.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"voz.gg/services/status-monitor/prober"
)

// version is injected at build time via -ldflags "-X main.version=<v>",
// sourced from the project's VERSION file. It defaults to "dev" for local builds.
var version = "dev"

func main() {
	configPath := flag.String("config", "/etc/voz-status-monitor/config.json", "path to config.json")
	workerBaseURL := flag.String("worker-base-url", "", "worker base URL (only used with -write-config)")
	writeConfig := flag.Bool("write-config", false, "read an enroll response from stdin and write config.json, then exit")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}

	if *writeConfig {
		cfg, err := ConfigFromEnroll(os.Stdin, *workerBaseURL)
		if err != nil {
			log.Fatalf("write-config: %v", err)
		}
		if err := SaveConfig(*configPath, cfg); err != nil {
			log.Fatalf("write-config: %v", err)
		}
		return
	}

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("load config %s: %v", *configPath, err)
	}

	agent := &Agent{
		Config:      cfg,
		Client:      &http.Client{Timeout: 10 * time.Second},
		ProberForFn: prober.For,
		ConfigPath:  *configPath,
	}

	run(context.Background(), agent)
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
