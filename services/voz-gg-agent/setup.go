package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultRunAs     = "voz-gg"
	monitorUnitName  = "voz-gg-agent-monitor.service"
	logparseUnitName = "voz-gg-agent-logparse.service"
	legacyUnitName   = "voz-status-monitor.service"
	legacyBinary     = "/usr/local/bin/voz-status-monitor"
	stateDir         = "/var/lib/voz-gg-agent"
)

// provisioning is the install-time policy block from the enroll response: the
// run-as identity plus capability toggles.
type provisioning struct {
	RunAsUser    string       `json:"runAsUser"`
	RunAsGroup   string       `json:"runAsGroup"`
	Capabilities capabilities `json:"capabilities"`
}

type capabilities struct {
	LogParser logParserCapability `json:"logParser"`
}

// logParserCapability mirrors apps/web buildProvisioning's capabilities.logParser.
type logParserCapability struct {
	Enabled        bool   `json:"enabled"`
	GameServerUser string `json:"gameServerUser"`
	LogPath        string `json:"logPath"`
}

// systemOps is the set of privileged host operations setup performs. Abstracted
// so the orchestration is unit-testable without root, systemd, or a network.
type systemOps interface {
	hasSystemd() bool
	groupExists(name string) bool
	userExists(name string) bool
	createSystemGroup(name string) error
	createSystemUser(name, group string) error
	mkdirAll(path string, perm uint32) error
	writeFile(path string, data []byte, perm uint32) error
	chownRecursive(path, user, group string) error
	run(name string, args ...string) error
	unitInstalled(name string) bool
	pathExists(path string) bool
	remove(path string) error
}

// enrollFn performs the enroll HTTP call. Abstracted for testing.
type enrollFn func(workerBaseURL, token string) (enrollResponse, error)

type setupOptions struct {
	EnrollmentToken string
	WorkerBaseURL   string
	ConfigPath      string
	ExecPath        string
	RunAsUser       string // override (flag/env); "" = use provisioning/default
	RunAsGroup      string // override (flag/env); "" = use provisioning/default
	NonInteractive  bool
	OpenTTY         func() (io.ReadWriteCloser, error)
}

// runSetupWith orchestrates provisioning against injected dependencies. It is
// the testable heart of `setup`: enroll, resolve identity, ensure the service
// account, write config + hardened unit, clean up the legacy install, enable.
func runSetupWith(opts setupOptions, sys systemOps, enroll enrollFn, stdout, stderr io.Writer) int {
	resp, err := enroll(opts.WorkerBaseURL, opts.EnrollmentToken)
	if err != nil {
		fmt.Fprintf(stderr, "setup: enroll failed: %v\n", err)
		return 1
	}

	runAsUser := firstNonEmpty(opts.RunAsUser, resp.Provisioning.RunAsUser, defaultRunAs)
	runAsGroup := firstNonEmpty(opts.RunAsGroup, resp.Provisioning.RunAsGroup, defaultRunAs)

	cfg := Config{
		WorkerBaseURL: opts.WorkerBaseURL,
		AgentToken:    resp.AgentToken,
		ConfigHash:    resp.ConfigHash,
		Server:        resp.Config,
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		fmt.Fprintf(stderr, "setup: encode config: %v\n", err)
		return 1
	}

	configDir := filepath.Dir(opts.ConfigPath)
	if err := sys.mkdirAll(configDir, 0o755); err != nil {
		fmt.Fprintf(stderr, "setup: mkdir %s: %v\n", configDir, err)
		return 1
	}

	// On a host without systemd (e.g. local/darwin), persist the config and stop —
	// creating users and a service is a Linux/systemd concern.
	if !sys.hasSystemd() {
		if err := sys.writeFile(opts.ConfigPath, raw, 0o600); err != nil {
			fmt.Fprintf(stderr, "setup: write config: %v\n", err)
			return 1
		}
		fmt.Fprintf(stdout, "Config written to %s. systemd not found; skipping service install.\n", opts.ConfigPath)
		return 0
	}

	if !sys.groupExists(runAsGroup) {
		if err := sys.createSystemGroup(runAsGroup); err != nil {
			fmt.Fprintf(stderr, "setup: create group %s: %v\n", runAsGroup, err)
			return 1
		}
	}
	if !sys.userExists(runAsUser) {
		if err := sys.createSystemUser(runAsUser, runAsGroup); err != nil {
			fmt.Fprintf(stderr, "setup: create user %s: %v\n", runAsUser, err)
			return 1
		}
	}

	if err := sys.writeFile(opts.ConfigPath, raw, 0o600); err != nil {
		fmt.Fprintf(stderr, "setup: write config: %v\n", err)
		return 1
	}
	if err := sys.chownRecursive(configDir, runAsUser, runAsGroup); err != nil {
		fmt.Fprintf(stderr, "setup: chown %s: %v\n", configDir, err)
		return 1
	}

	unit := renderMonitorUnit(opts.ExecPath, opts.ConfigPath, configDir, runAsUser, runAsGroup)
	if err := sys.writeFile("/etc/systemd/system/"+monitorUnitName, []byte(unit), 0o644); err != nil {
		fmt.Fprintf(stderr, "setup: write unit: %v\n", err)
		return 1
	}

	// Best-effort cleanup of the legacy status-monitor install.
	if sys.unitInstalled(legacyUnitName) {
		_ = sys.run("systemctl", "disable", "--now", legacyUnitName)
		_ = sys.remove("/etc/systemd/system/" + legacyUnitName)
	}
	_ = sys.remove(legacyBinary)

	if err := sys.run("systemctl", "daemon-reload"); err != nil {
		fmt.Fprintf(stderr, "setup: daemon-reload: %v\n", err)
		return 1
	}
	if err := sys.run("systemctl", "enable", "--now", monitorUnitName); err != nil {
		fmt.Fprintf(stderr, "setup: enable service: %v\n", err)
		return 1
	}

	fmt.Fprintf(stdout, "voz-gg-agent monitor installed and started as %s:%s\n", runAsUser, runAsGroup)

	if lp := resp.Provisioning.Capabilities.LogParser; lp.Enabled {
		var ttyIn io.Reader
		var ttyOut io.Writer
		if !opts.NonInteractive {
			tty, err := opts.OpenTTY()
			if err != nil {
				fmt.Fprintf(stderr, "setup: cannot open /dev/tty for log-dir setup; re-run with --non-interactive: %v\n", err)
				return 1
			}
			defer tty.Close()
			ttyIn, ttyOut = tty, tty
		}
		logDir, err := resolveLogDir(lp, !opts.NonInteractive, ttyIn, ttyOut, sys)
		if err != nil {
			fmt.Fprintf(stderr, "setup: %v\n", err)
			return 1
		}
		if err := sys.mkdirAll(stateDir, 0o750); err != nil {
			fmt.Fprintf(stderr, "setup: mkdir %s: %v\n", stateDir, err)
			return 1
		}
		if err := sys.chownRecursive(stateDir, runAsUser, runAsGroup); err != nil {
			fmt.Fprintf(stderr, "setup: chown %s: %v\n", stateDir, err)
			return 1
		}
		lpUnit := renderLogparseUnit(opts.ExecPath, opts.ConfigPath, logDir, stateDir, runAsUser, runAsGroup, lp.GameServerUser)
		if err := sys.writeFile("/etc/systemd/system/"+logparseUnitName, []byte(lpUnit), 0o644); err != nil {
			fmt.Fprintf(stderr, "setup: write logparse unit: %v\n", err)
			return 1
		}
		if err := sys.run("systemctl", "daemon-reload"); err != nil {
			fmt.Fprintf(stderr, "setup: daemon-reload: %v\n", err)
			return 1
		}
		if err := sys.run("systemctl", "enable", "--now", logparseUnitName); err != nil {
			fmt.Fprintf(stderr, "setup: enable logparse service: %v\n", err)
			return 1
		}
		fmt.Fprintf(stdout, "voz-gg-agent logparse installed and started; reading %s\n", logDir)
	}

	return 0
}

// resolveLogDir determines the game-server log directory for the logparse unit.
// Non-interactive: require the provisioned LogPath. Interactive: scan candidate
// locations for a latest.log, present them on the injected tty, and let the
// operator confirm the discovered default or type a path.
func resolveLogDir(cap logParserCapability, interactive bool, in io.Reader, out io.Writer, sys systemOps) (string, error) {
	user := cap.GameServerUser
	if user == "" {
		user = "minecraft"
	}
	candidates := dedupeNonEmpty(cap.LogPath, "/home/"+user+"/logs", "/opt/"+user+"/logs")

	if !interactive {
		if cap.LogPath == "" {
			return "", errors.New("log parsing enabled but no log path provided; set it in the server config or run setup interactively")
		}
		return cap.LogPath, nil
	}

	def := ""
	for _, c := range candidates {
		if sys.pathExists(filepath.Join(c, "latest.log")) {
			def = c
			break
		}
	}
	if def == "" && len(candidates) > 0 {
		def = candidates[0]
	}

	fmt.Fprintln(out, "Detecting the game-server log directory...")
	for _, c := range candidates {
		mark := ""
		if sys.pathExists(filepath.Join(c, "latest.log")) {
			mark = "  (found latest.log)"
		}
		fmt.Fprintf(out, "  %s%s\n", c, mark)
	}
	fmt.Fprintf(out, "Log directory [%s]: ", def)

	line, _ := bufio.NewReader(in).ReadString('\n')
	chosen := strings.TrimSpace(line)
	if chosen == "" {
		chosen = def
	}
	if chosen == "" {
		return "", errors.New("no log directory provided")
	}
	if !sys.pathExists(filepath.Join(chosen, "latest.log")) {
		fmt.Fprintf(out, "warning: %s has no latest.log yet; the daemon will wait for it to appear.\n", chosen)
	}
	return chosen, nil
}

// dedupeNonEmpty returns the inputs with empties and later duplicates removed,
// preserving order.
func dedupeNonEmpty(vals ...string) []string {
	seen := map[string]bool{}
	var out []string
	for _, v := range vals {
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

func renderMonitorUnit(execPath, configPath, configDir, user, group string) string {
	return fmt.Sprintf(`[Unit]
Description=voz.gg agent (monitor)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%s monitor -config %s
Restart=always
RestartSec=5
User=%s
Group=%s
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=%s

[Install]
WantedBy=multi-user.target
`, execPath, configPath, user, group, configDir)
}

// renderLogparseUnit builds the hardened logparse service. It differs from the
// monitor unit in exactly what it needs to read another user's logs safely:
// SupplementaryGroups grants read of the game server's group-readable logs,
// ProtectHome is relaxed to read-only (Minecraft logs live under /home), the log
// dir is read-only, and only the state dir (checkpoint) is writable.
func renderLogparseUnit(execPath, configPath, logDir, stateDir, user, group, gameServerUser string) string {
	supplementary := ""
	if gameServerUser != "" {
		supplementary = "SupplementaryGroups=" + gameServerUser + "\n"
	}
	return fmt.Sprintf(`[Unit]
Description=voz.gg agent (logparse)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%s logparse -config %s -log-dir %s -checkpoint %s/logparse-checkpoint.json
Restart=always
RestartSec=5
User=%s
Group=%s
%sNoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
ReadOnlyPaths=%s
ReadWritePaths=%s

[Install]
WantedBy=multi-user.target
`, execPath, configPath, logDir, stateDir, user, group, supplementary, logDir, stateDir)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// runSetup parses flags/env and runs the orchestration with real dependencies.
func runSetup(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	fs.SetOutput(stderr)
	token := fs.String("enrollment-token", "", "enrollment token (required)")
	workerBaseURL := fs.String("worker-base-url", "", "worker base URL (required)")
	configPath := fs.String("config", defaultConfigPath, "path to write the monitor config")
	runAsUser := fs.String("run-as-user", envOr("VOZ_RUN_AS_USER", ""), "override the run-as user")
	runAsGroup := fs.String("run-as-group", envOr("VOZ_RUN_AS_GROUP", ""), "override the run-as group")
	nonInteractive := fs.Bool("non-interactive", false, "do not prompt; require all config from provisioning")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if *token == "" || *workerBaseURL == "" {
		fmt.Fprintln(stderr, "setup: --enrollment-token and --worker-base-url are required")
		return 2
	}
	execPath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(stderr, "setup: cannot resolve own path: %v\n", err)
		return 1
	}
	opts := setupOptions{
		EnrollmentToken: *token,
		WorkerBaseURL:   *workerBaseURL,
		ConfigPath:      *configPath,
		ExecPath:        execPath,
		RunAsUser:       *runAsUser,
		RunAsGroup:      *runAsGroup,
		NonInteractive:  *nonInteractive,
		OpenTTY:         openDevTTY,
	}
	return runSetupWith(opts, realSystem{}, httpEnroll, stdout, stderr)
}

// openDevTTY opens the controlling terminal for interactive prompts, independent
// of stdin (which is the piped installer under `curl | sudo sh`).
func openDevTTY() (io.ReadWriteCloser, error) {
	return os.OpenFile("/dev/tty", os.O_RDWR, 0)
}

// httpEnroll POSTs the enrollment token to the Worker and decodes the response.
func httpEnroll(workerBaseURL, token string) (enrollResponse, error) {
	body, err := json.Marshal(map[string]string{"enrollmentToken": token})
	if err != nil {
		return enrollResponse{}, err
	}
	req, err := http.NewRequest(http.MethodPost, workerBaseURL+"/api/agents/enroll", bytes.NewReader(body))
	if err != nil {
		return enrollResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	httpResp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return enrollResponse{}, err
	}
	defer httpResp.Body.Close()
	if httpResp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(httpResp.Body)
		return enrollResponse{}, fmt.Errorf("enroll returned %d: %s", httpResp.StatusCode, b)
	}
	var resp enrollResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil {
		return enrollResponse{}, err
	}
	if resp.AgentToken == "" {
		return enrollResponse{}, errors.New("enroll: server returned an empty agent token")
	}
	return resp, nil
}

// realSystem implements systemOps against the host (Linux/systemd).
type realSystem struct{}

func (realSystem) hasSystemd() bool          { _, err := exec.LookPath("systemctl"); return err == nil }
func (realSystem) groupExists(n string) bool { return exec.Command("getent", "group", n).Run() == nil }
func (realSystem) userExists(n string) bool  { return exec.Command("getent", "passwd", n).Run() == nil }
func (realSystem) createSystemGroup(n string) error {
	return runLogged("groupadd", "--system", n)
}
func (realSystem) createSystemUser(n, g string) error {
	return runLogged("useradd", "--system", "--no-create-home", "--shell", "/usr/sbin/nologin", "-g", g, n)
}
func (realSystem) mkdirAll(p string, perm uint32) error { return os.MkdirAll(p, os.FileMode(perm)) }
func (realSystem) writeFile(p string, d []byte, perm uint32) error {
	return os.WriteFile(p, d, os.FileMode(perm))
}
func (realSystem) chownRecursive(p, u, g string) error   { return runLogged("chown", "-R", u+":"+g, p) }
func (realSystem) run(name string, args ...string) error { return runLogged(name, args...) }
func (realSystem) unitInstalled(n string) bool {
	_, err := os.Stat("/etc/systemd/system/" + n)
	return err == nil
}
func (realSystem) pathExists(p string) bool { _, err := os.Stat(p); return err == nil }
func (realSystem) remove(p string) error {
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func runLogged(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v: %v: %s", name, args, err, out)
	}
	return nil
}
