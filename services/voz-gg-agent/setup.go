package main

import (
	"bufio"
	"bytes"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"hash"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
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
	LogParser     logParserCapability     `json:"logParser"`
	ServerControl serverControlCapability `json:"serverControl"`
	Updates       updatesCapability       `json:"updates"`
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
	readFile(path string) ([]byte, error)
	chownRecursive(path, user, group string) error
	run(name string, args ...string) error
	unitInstalled(name string) bool
	pathExists(path string) bool
	remove(path string) error
	rename(oldPath, newPath string) error
	binaryVersion(path string) (string, error)
	reExec(path string, args []string) error
	symlink(target, link string) error
	readlink(path string) (string, error)
	downloadTo(url, dest string) (int64, error)
	hashFile(path, algo string) (string, error)
	copyTreeHardlink(src, dst string) error
	removeAll(path string) error
	listDir(path string) ([]string, error)
	walkFiles(path string) []string
	runIn(dir, name string, args ...string) error
	reflinkCopy(src, dst string) (bool, error)
	copyTreeDeep(src, dst string) error
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
		IngestBaseURL: resp.IngestBaseURL,
		AgentToken:    resp.AgentToken,
		ConfigHash:    resp.ConfigHash,
		Server:        resp.Config,
	}
	// Seed RCON from the existing config so a re-run does not rotate the password.
	// LoadConfig errors (file absent on a fresh install) are intentionally ignored.
	if existing, err := LoadConfig(opts.ConfigPath); err == nil {
		cfg.RCON = existing.RCON
	}
	sc := resp.Provisioning.Capabilities.ServerControl
	if _, err := ensureRconPassword(&cfg, sc); err != nil {
		fmt.Fprintf(stderr, "setup: %v\n", err)
		return 1
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

	if err := reconcileLogparse(sys, resp.Provisioning.Capabilities.LogParser, opts.ExecPath, opts.ConfigPath, runAsUser, runAsGroup, opts.NonInteractive, false, opts.OpenTTY, stdout); err != nil {
		fmt.Fprintf(stderr, "setup: %v\n", err)
		return 1
	}

	if err := reconcileServerControl(sys, sc, cfg.RCON.Password, cfg.RCON.Port, opts.ExecPath, opts.ConfigPath, stdout); err != nil {
		fmt.Fprintf(stderr, "setup: %v\n", err)
		return 1
	}

	if err := reconcileUpdates(sys, resp.Provisioning.Capabilities.Updates, sc, opts.ExecPath, opts.ConfigPath, stdout); err != nil {
		fmt.Fprintf(stderr, "setup: %v\n", err)
		return 1
	}

	return 0
}

// reconcileLogparse brings the logparse unit into line with the capability: when
// enabled it resolves the log directory, ensures the state dir, and installs +
// enables the hardened unit; when disabled it disables and removes any unit left
// behind. Shared by setup and reprovision so both converge on the same systemd
// state for a given provisioning.
func reconcileLogparse(sys systemOps, lp logParserCapability, execPath, configPath, runAsUser, runAsGroup string, nonInteractive, reuseExisting bool, openTTY func() (io.ReadWriteCloser, error), stdout io.Writer) error {
	if !lp.Enabled {
		if sys.unitInstalled(logparseUnitName) {
			_ = sys.run("systemctl", "disable", "--now", logparseUnitName)
			_ = sys.remove("/etc/systemd/system/" + logparseUnitName)
			if err := sys.run("systemctl", "daemon-reload"); err != nil {
				return fmt.Errorf("daemon-reload: %w", err)
			}
			fmt.Fprintln(stdout, "voz-gg-agent logparse disabled and removed")
		}
		return nil
	}

	// On reprovision/update the log directory was already resolved at setup and
	// baked into the installed unit; reuse it so we never re-prompt for a setting
	// that is already in place. Only a fresh enable (no unit yet) falls through to
	// provisioning/the interactive prompt.
	logDir := ""
	if reuseExisting {
		logDir = installedLogparseDir(sys)
	}
	if logDir == "" {
		var ttyIn io.Reader
		var ttyOut io.Writer
		if !nonInteractive {
			tty, err := openTTY()
			if err != nil {
				return fmt.Errorf("cannot open /dev/tty for log-dir setup; re-run with --non-interactive: %w", err)
			}
			defer tty.Close()
			ttyIn, ttyOut = tty, tty
		}
		resolved, err := resolveLogDir(lp, !nonInteractive, ttyIn, ttyOut, sys)
		if err != nil {
			return err
		}
		logDir = resolved
	}
	if err := sys.mkdirAll(stateDir, 0o750); err != nil {
		return fmt.Errorf("mkdir %s: %w", stateDir, err)
	}
	if err := sys.chownRecursive(stateDir, runAsUser, runAsGroup); err != nil {
		return fmt.Errorf("chown %s: %w", stateDir, err)
	}
	lpUnit := renderLogparseUnit(execPath, configPath, logDir, stateDir, runAsUser, runAsGroup, lp.GameServerUser)
	if err := sys.writeFile("/etc/systemd/system/"+logparseUnitName, []byte(lpUnit), 0o644); err != nil {
		return fmt.Errorf("write logparse unit: %w", err)
	}
	if err := sys.run("systemctl", "daemon-reload"); err != nil {
		return fmt.Errorf("daemon-reload: %w", err)
	}
	if err := sys.run("systemctl", "enable", "--now", logparseUnitName); err != nil {
		return fmt.Errorf("enable logparse service: %w", err)
	}
	fmt.Fprintf(stdout, "voz-gg-agent logparse installed and started; reading %s\n", logDir)
	return nil
}

// installedLogparseDir returns the -log-dir already baked into the installed
// logparse unit's ExecStart, or "" if the unit is absent or has no such flag.
// Reusing it lets reprovision/update reconcile without re-prompting for the log
// directory the operator already chose at setup.
func installedLogparseDir(sys systemOps) string {
	raw, err := sys.readFile("/etc/systemd/system/" + logparseUnitName)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(line, "ExecStart=") {
			continue
		}
		fields := strings.Fields(line)
		for i, f := range fields {
			if f == "-log-dir" && i+1 < len(fields) {
				return fields[i+1]
			}
		}
	}
	return ""
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
func (realSystem) readFile(p string) ([]byte, error)     { return os.ReadFile(p) }
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
func (realSystem) rename(oldPath, newPath string) error { return os.Rename(oldPath, newPath) }
func (realSystem) binaryVersion(path string) (string, error) {
	out, err := exec.Command(path, "version").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// reExec replaces the current process image with path. On success it does not
// return; the new binary takes over with the same controlling terminal, so any
// /dev/tty prompts in the reconcile phase still work.
func (realSystem) reExec(path string, args []string) error {
	return syscall.Exec(path, args, os.Environ())
}

func (realSystem) symlink(target, link string) error {
	_ = os.Remove(link)
	return os.Symlink(target, link)
}
func (realSystem) readlink(path string) (string, error) { return os.Readlink(path) }
func (realSystem) downloadTo(url, dest string) (int64, error) {
	resp, err := http.Get(url) //nolint:gosec // url is the trusted Worker-supplied desired-release artifact
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("download %s: status %d", url, resp.StatusCode)
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return 0, err
	}
	n, err := io.Copy(f, resp.Body)
	f.Close()
	if err != nil {
		os.Remove(tmp)
		return 0, err
	}
	if err := os.Rename(tmp, dest); err != nil {
		return 0, err
	}
	return n, nil
}

// hashFile hashes a file with sha1 or sha256. sha1 is used only to match Mojang's
// published server-jar integrity hash — it is an integrity check, not a security
// primitive.
func (realSystem) hashFile(path, algo string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	var h hash.Hash
	switch algo {
	case "sha1":
		h = sha1.New()
	case "sha256":
		h = sha256.New()
	default:
		return "", fmt.Errorf("unsupported hash algo %q", algo)
	}
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func (realSystem) copyTreeHardlink(src, dst string) error {
	return runLogged("cp", "-al", src, dst)
}
func (realSystem) removeAll(path string) error { return os.RemoveAll(path) }
func (realSystem) runIn(dir, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %v: %s", name, err, out)
	}
	return nil
}

// reflinkCopy tries a CoW clone. On Linux it shells out to `cp --reflink=always
// -a`; on filesystems/platforms without reflink support it returns (false, nil)
// so the caller falls back to a deep copy.
func (realSystem) reflinkCopy(src, dst string) (bool, error) {
	cmd := exec.Command("cp", "--reflink=always", "-a", src, dst)
	if err := cmd.Run(); err != nil {
		_ = os.RemoveAll(dst)
		return false, nil
	}
	return true, nil
}

func (realSystem) copyTreeDeep(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		return copyFileMode(p, target, info.Mode().Perm())
	})
}

// copyFileMode copies one file, preserving its permission bits. It is a separate
// function so each file's descriptors are released as it returns: copying a tree
// inside a single filepath.WalkDir callback would keep every file's fd open until
// the entire walk finished and exhaust the open-file limit on a large tree.
func copyFileMode(srcPath, dstPath string, mode os.FileMode) error {
	in, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dstPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func (realSystem) listDir(path string) ([]string, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out, nil
}

func (realSystem) walkFiles(root string) []string {
	var out []string
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if rel, relErr := filepath.Rel(root, p); relErr == nil {
			out = append(out, rel)
		}
		return nil
	})
	return out
}

func runLogged(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v: %v: %s", name, args, err, out)
	}
	return nil
}
