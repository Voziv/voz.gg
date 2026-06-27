package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// provisionFn fetches the agent's current config + provisioning using its agent
// token. Abstracted for testing.
type provisionFn func(workerBaseURL, agentToken string) (enrollResponse, error)

type reprovisionOptions struct {
	WorkerBaseURL  string
	ConfigPath     string
	ExecPath       string
	RunAsUser      string // override (flag/env); "" = use provisioning/default
	RunAsGroup     string // override (flag/env); "" = use provisioning/default
	NonInteractive bool
	OpenTTY        func() (io.ReadWriteCloser, error)
}

// runReprovisionWith re-fetches provisioning with the existing agent token (no
// enrollment, no token rotation), rewrites the config, reconciles the logparse
// unit to match the new capability, and restarts the affected units so changes
// apply immediately — `enable --now` does not restart an already-running unit.
func runReprovisionWith(opts reprovisionOptions, cfg Config, sys systemOps, fetch provisionFn, save func(Config) error, stdout, stderr io.Writer) int {
	resp, err := fetch(opts.WorkerBaseURL, cfg.AgentToken)
	if err != nil {
		fmt.Fprintf(stderr, "reprovision: fetch failed: %v\n", err)
		return 1
	}

	cfg.Server = resp.Config
	cfg.ConfigHash = resp.ConfigHash
	// Only overwrite when the worker returns a value, so an older worker that does
	// not yet send ingestBaseUrl never blanks a previously-stored URL.
	if resp.IngestBaseURL != "" {
		cfg.IngestBaseURL = resp.IngestBaseURL
	}
	sc := resp.Provisioning.Capabilities.ServerControl
	if _, err := ensureRconPassword(&cfg, sc); err != nil {
		fmt.Fprintf(stderr, "reprovision: %v\n", err)
		return 1
	}
	if err := save(cfg); err != nil {
		fmt.Fprintf(stderr, "reprovision: write config: %v\n", err)
		return 1
	}

	// On a host without systemd (e.g. local/darwin), refreshing the config is all
	// we can do — there are no units to reconcile.
	if !sys.hasSystemd() {
		fmt.Fprintf(stdout, "Config refreshed at %s. systemd not found; skipping unit reconcile.\n", opts.ConfigPath)
		return 0
	}

	runAsUser := firstNonEmpty(opts.RunAsUser, resp.Provisioning.RunAsUser, defaultRunAs)
	runAsGroup := firstNonEmpty(opts.RunAsGroup, resp.Provisioning.RunAsGroup, defaultRunAs)

	if err := reconcileLogparse(sys, resp.Provisioning.Capabilities.LogParser, opts.ExecPath, opts.ConfigPath, runAsUser, runAsGroup, opts.NonInteractive, true, opts.OpenTTY, stdout); err != nil {
		fmt.Fprintf(stderr, "reprovision: %v\n", err)
		return 1
	}

	if sys.unitInstalled(monitorUnitName) {
		if err := sys.run("systemctl", "restart", monitorUnitName); err != nil {
			fmt.Fprintf(stderr, "reprovision: restart monitor: %v\n", err)
			return 1
		}
	}
	if resp.Provisioning.Capabilities.LogParser.Enabled {
		if err := sys.run("systemctl", "restart", logparseUnitName); err != nil {
			fmt.Fprintf(stderr, "reprovision: restart logparse: %v\n", err)
			return 1
		}
	}

	if err := reconcileServerControl(sys, sc, cfg.RCON.Password, cfg.RCON.Port, opts.ExecPath, opts.ConfigPath, stdout); err != nil {
		fmt.Fprintf(stderr, "reprovision: %v\n", err)
		return 1
	}

	if err := reconcileUpdates(sys, resp.Provisioning.Capabilities.Updates, sc, opts.ExecPath, opts.ConfigPath, stdout); err != nil {
		fmt.Fprintf(stderr, "reprovision: %v\n", err)
		return 1
	}

	fmt.Fprintf(stdout, "voz-gg-agent reprovisioned as %s:%s\n", runAsUser, runAsGroup)
	return 0
}

// runReprovision parses flags/env and runs the reconcile with real dependencies.
func runReprovision(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("reprovision", flag.ContinueOnError)
	fs.SetOutput(stderr)
	configPath := fs.String("config", defaultConfigPath, "path to the monitor config json")
	workerBaseURL := fs.String("worker-base-url", "", "override the worker base URL (defaults to the value in config)")
	runAsUser := fs.String("run-as-user", envOr("VOZ_RUN_AS_USER", ""), "override the run-as user")
	runAsGroup := fs.String("run-as-group", envOr("VOZ_RUN_AS_GROUP", ""), "override the run-as group")
	nonInteractive := fs.Bool("non-interactive", false, "do not prompt; require all config from provisioning")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(stderr, "reprovision: load config %s: %v\n", *configPath, err)
		return 1
	}
	base := firstNonEmpty(*workerBaseURL, cfg.WorkerBaseURL)
	if base == "" {
		fmt.Fprintln(stderr, "reprovision: no worker base URL in config; pass --worker-base-url")
		return 2
	}
	if cfg.AgentToken == "" {
		fmt.Fprintln(stderr, "reprovision: config has no agent token; run setup first")
		return 1
	}
	execPath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(stderr, "reprovision: cannot resolve own path: %v\n", err)
		return 1
	}

	opts := reprovisionOptions{
		WorkerBaseURL:  base,
		ConfigPath:     *configPath,
		ExecPath:       execPath,
		RunAsUser:      *runAsUser,
		RunAsGroup:     *runAsGroup,
		NonInteractive: *nonInteractive,
		OpenTTY:        openDevTTY,
	}
	return runReprovisionWith(opts, cfg, realSystem{}, httpProvision, func(c Config) error {
		return SaveConfig(*configPath, c)
	}, stdout, stderr)
}

// httpProvision GETs /api/agents/config authenticated with the agent token. The
// endpoint returns config + configHash + provisioning; the agent token is left
// untouched (no enrollment), so the response carries no new token.
func httpProvision(workerBaseURL, agentToken string) (enrollResponse, error) {
	req, err := http.NewRequest(http.MethodGet, workerBaseURL+"/api/agents/config", nil)
	if err != nil {
		return enrollResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+agentToken)
	httpResp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return enrollResponse{}, err
	}
	defer httpResp.Body.Close()
	if httpResp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(httpResp.Body)
		return enrollResponse{}, fmt.Errorf("config returned %d: %s", httpResp.StatusCode, b)
	}
	var resp enrollResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil {
		return enrollResponse{}, err
	}
	return resp, nil
}
