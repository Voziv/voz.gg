package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// The rolling "latest" release the install script also pulls from. Independent
// per-project releasing means GitHub's /releases/latest can point elsewhere, so
// both the installer and self-update target this fixed tag.
const (
	releaseRepoOwner = "Voziv"
	releaseRepoName  = "voz.gg"
	releaseTag       = "voz-gg-agent-latest"
)

// downloadFn fetches the release binary bytes. Abstracted for testing.
type downloadFn func(url string) ([]byte, error)

type updateOptions struct {
	URL            string
	ExecPath       string
	ConfigPath     string
	CurrentVersion string
	NonInteractive bool
}

// reconcileOptions drives the second phase of update (or a direct
// `--reconcile-only` invocation): refresh config + units using the binary that
// is already in place.
type reconcileOptions struct {
	ConfigPath     string
	ExecPath       string
	RunAsUser      string
	RunAsGroup     string
	NonInteractive bool
	OpenTTY        func() (io.ReadWriteCloser, error)
}

// latestReleaseURL builds the asset URL for this host's OS/arch. The release
// assets are named with Go's GOOS/GOARCH (linux-amd64, linux-arm64, darwin-arm64),
// which runtime already reports in that form — no uname-style mapping needed.
func latestReleaseURL() string {
	return fmt.Sprintf("https://github.com/%s/%s/releases/download/%s/voz-gg-agent-%s-%s",
		releaseRepoOwner, releaseRepoName, releaseTag, runtime.GOOS, runtime.GOARCH)
}

// runUpdateWith is the first phase of self-update: download the latest release,
// swap it in over the running executable when the version differs, then re-exec
// the now-current binary to run the config + unit reconcile. Re-execing is what
// guarantees the reconcile uses the *new* code — the running process is still the
// old binary until it is replaced. The download is buffered and only renamed into
// place on success, so a failed fetch never corrupts the installed binary.
func runUpdateWith(opts updateOptions, sys systemOps, download downloadFn, stdout, stderr io.Writer) int {
	fmt.Fprintf(stdout, "Downloading %s\n", opts.URL)
	data, err := download(opts.URL)
	if err != nil {
		fmt.Fprintf(stderr, "update: download failed: %v\n", err)
		return 1
	}

	tmp := opts.ExecPath + ".new"
	if err := sys.writeFile(tmp, data, 0o755); err != nil {
		fmt.Fprintf(stderr, "update: write %s: %v\n", tmp, err)
		return 1
	}

	newVersion, err := sys.binaryVersion(tmp)
	if err != nil {
		_ = sys.remove(tmp)
		fmt.Fprintf(stderr, "update: cannot read downloaded binary version: %v\n", err)
		return 1
	}

	if newVersion == opts.CurrentVersion {
		_ = sys.remove(tmp)
		fmt.Fprintf(stdout, "Already on %s; refreshing config and units.\n", newVersion)
	} else {
		if err := sys.rename(tmp, opts.ExecPath); err != nil {
			_ = sys.remove(tmp)
			fmt.Fprintf(stderr, "update: replace %s: %v\n", opts.ExecPath, err)
			return 1
		}
		fmt.Fprintf(stdout, "Updated %s: %s -> %s\n", opts.ExecPath, opts.CurrentVersion, newVersion)
	}

	// Re-exec the now-current binary so the config + unit reconcile runs the new
	// code. --reconcile-only skips the download and goes straight to phase two.
	reArgs := []string{opts.ExecPath, "update", "--reconcile-only", "-config", opts.ConfigPath}
	if opts.NonInteractive {
		reArgs = append(reArgs, "--non-interactive")
	}
	if err := sys.reExec(opts.ExecPath, reArgs); err != nil {
		fmt.Fprintf(stderr, "update: re-exec %s: %v\n", opts.ExecPath, err)
		return 1
	}
	return 0 // unreachable after a successful real exec; a fake reExec returns here
}

// runReconcileWith is the second phase: with a valid agent key it re-fetches
// provisioning and reconciles config + units exactly like reprovision; without a
// key (or config) it just restarts the installed units so they exec the new
// binary.
func runReconcileWith(opts reconcileOptions, sys systemOps, fetch provisionFn, loadConfig func(string) (Config, error), save func(string, Config) error, stdout, stderr io.Writer) int {
	cfg, err := loadConfig(opts.ConfigPath)
	if err != nil {
		fmt.Fprintf(stdout, "update: no config at %s; restarting installed units only.\n", opts.ConfigPath)
		return restartInstalledUnits(sys, stdout, stderr)
	}
	if cfg.AgentToken == "" || cfg.WorkerBaseURL == "" {
		fmt.Fprintln(stdout, "update: no valid agent key in config; restarting installed units only.")
		return restartInstalledUnits(sys, stdout, stderr)
	}

	rop := reprovisionOptions{
		WorkerBaseURL:  cfg.WorkerBaseURL,
		ConfigPath:     opts.ConfigPath,
		ExecPath:       opts.ExecPath,
		RunAsUser:      opts.RunAsUser,
		RunAsGroup:     opts.RunAsGroup,
		NonInteractive: opts.NonInteractive,
		OpenTTY:        opts.OpenTTY,
	}
	return runReprovisionWith(rop, cfg, sys, fetch, func(c Config) error {
		return save(opts.ConfigPath, c)
	}, stdout, stderr)
}

// restartInstalledUnits bounces whatever units are installed so they exec the
// current binary. Used when there is no key to reconcile against.
func restartInstalledUnits(sys systemOps, stdout, stderr io.Writer) int {
	if !sys.hasSystemd() {
		fmt.Fprintln(stdout, "systemd not found; nothing to restart.")
		return 0
	}
	for _, unit := range []string{monitorUnitName, logparseUnitName} {
		if !sys.unitInstalled(unit) {
			continue
		}
		if err := sys.run("systemctl", "restart", unit); err != nil {
			fmt.Fprintf(stderr, "update: restart %s: %v\n", unit, err)
			return 1
		}
		fmt.Fprintf(stdout, "Restarted %s\n", unit)
	}
	return 0
}

// runUpdate parses flags and runs the appropriate phase with real dependencies.
func runUpdate(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("update", flag.ContinueOnError)
	fs.SetOutput(stderr)
	url := fs.String("url", "", "override the release binary URL (defaults to the latest release for this OS/arch)")
	configPath := fs.String("config", defaultConfigPath, "path to the monitor config json")
	reconcileOnly := fs.Bool("reconcile-only", false, "internal: skip the download and only refresh config + units with the current binary (used by the re-exec after a swap)")
	nonInteractive := fs.Bool("non-interactive", false, "do not prompt; require all config from provisioning")
	runAsUser := fs.String("run-as-user", envOr("VOZ_RUN_AS_USER", ""), "override the run-as user")
	runAsGroup := fs.String("run-as-group", envOr("VOZ_RUN_AS_GROUP", ""), "override the run-as group")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}

	execPath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(stderr, "update: cannot resolve own path: %v\n", err)
		return 1
	}
	// Replace / re-exec the real file, not a symlink pointing at it.
	if resolved, err := filepath.EvalSymlinks(execPath); err == nil {
		execPath = resolved
	}

	if *reconcileOnly {
		opts := reconcileOptions{
			ConfigPath:     *configPath,
			ExecPath:       execPath,
			RunAsUser:      *runAsUser,
			RunAsGroup:     *runAsGroup,
			NonInteractive: *nonInteractive,
			OpenTTY:        openDevTTY,
		}
		return runReconcileWith(opts, realSystem{}, httpProvision, LoadConfig, SaveConfig, stdout, stderr)
	}

	opts := updateOptions{
		URL:            firstNonEmpty(*url, latestReleaseURL()),
		ExecPath:       execPath,
		ConfigPath:     *configPath,
		CurrentVersion: version,
		NonInteractive: *nonInteractive,
	}
	return runUpdateWith(opts, realSystem{}, httpDownload, stdout, stderr)
}

// httpDownload GETs the release binary, following GitHub's redirect to storage.
func httpDownload(url string) ([]byte, error) {
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("download returned %d: %s", resp.StatusCode, b)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, errors.New("downloaded an empty binary")
	}
	return data, nil
}
