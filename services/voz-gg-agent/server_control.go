package main

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const defaultRconPort = 25575

// serverControlCapability mirrors apps/web buildProvisioning's
// capabilities.serverControl. The password is never part of this block — the
// agent mints it locally so the Worker never learns it.
type serverControlCapability struct {
	Enabled         bool   `json:"enabled"`
	Slug            string `json:"slug"`
	ServerUser      string `json:"serverUser"`
	WorkingDir      string `json:"workingDir"`
	StartCommand    string `json:"startCommand"`
	RestartSchedule string `json:"restartSchedule"`
	RconPort        int    `json:"rconPort"`
	JvmArgs         string `json:"jvmArgs"`
}

// ensureRconPassword mints the RCON password once when server control is enabled
// and fixes the port, mutating cfg. It returns whether cfg changed so the caller
// can persist. Disabled capability is a no-op (never mints).
func ensureRconPassword(cfg *Config, sc serverControlCapability) (bool, error) {
	if !sc.Enabled {
		return false, nil
	}
	changed := false
	if cfg.RCON.Password == "" {
		pw, err := generatePassword()
		if err != nil {
			return false, err
		}
		cfg.RCON.Password = pw
		changed = true
	}
	port := sc.RconPort
	if port == 0 {
		port = defaultRconPort
	}
	if cfg.RCON.Port != port {
		cfg.RCON.Port = port
		changed = true
	}
	return changed, nil
}

func generatePassword() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// setProperties returns content with each key in updates set to its value:
// existing keys are rewritten in place (order and unrelated lines preserved),
// missing keys are appended in sorted order. When nothing changes the output is
// byte-identical to the input.
func setProperties(content string, updates map[string]string) string {
	done := map[string]bool{}
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		if v, ok := updates[key]; ok {
			lines[i] = key + "=" + v
			done[key] = true
		}
	}
	var missing []string
	for k := range updates {
		if !done[k] {
			missing = append(missing, k)
		}
	}
	sort.Strings(missing)
	out := strings.Join(lines, "\n")
	for _, k := range missing {
		if out != "" && !strings.HasSuffix(out, "\n") {
			out += "\n"
		}
		out += k + "=" + updates[k] + "\n"
	}
	return out
}

// readProperty returns the value of key, or "" if absent.
func readProperty(content, key string) string {
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		if strings.TrimSpace(line[:eq]) == key {
			return strings.TrimSpace(line[eq+1:])
		}
	}
	return ""
}

func serverControlUnitName(slug string) string { return "voz-gg-" + slug + ".service" }
func restartServiceName(slug string) string    { return "voz-gg-" + slug + "-restart.service" }
func restartTimerName(slug string) string      { return "voz-gg-" + slug + "-restart.timer" }

// sanitizeSlug lowercases and reduces s to systemd/filesystem-safe [a-z0-9-]
// (spaces and underscores become hyphens). An empty result is an error — we will
// not guess a unit name.
func sanitizeSlug(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			b.WriteRune(r)
		case r == ' ' || r == '_':
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "", errors.New("server control: slug is empty or invalid")
	}
	return out, nil
}

var scheduleRe = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// validateSchedule checks a UTC HH:MM restart time.
func validateSchedule(s string) (string, error) {
	s = strings.TrimSpace(s)
	if !scheduleRe.MatchString(s) {
		return "", fmt.Errorf("server control: invalid restart schedule %q (want UTC HH:MM)", s)
	}
	return s, nil
}

func renderServerControlUnit(execPath, slug, user, workingDir, startCommand, configPath string) string {
	props := filepath.Join(workingDir, "server.properties")
	return fmt.Sprintf(`[Unit]
Description=voz.gg game server (%s)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=%s
WorkingDirectory=%s
ExecStart=%s
ExecStop=-%s rcon --properties %s save-all
ExecStop=-%s rcon --properties %s stop
TimeoutStopSec=120
Restart=on-failure
RestartSec=10
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
`, slug, user, workingDir, startCommand, execPath, props, execPath, props)
}

func renderRestartService(execPath, slug, configPath string) string {
	unit := serverControlUnitName(slug)
	return fmt.Sprintf(`[Unit]
Description=voz.gg game server restart (%s)
After=%s

[Service]
Type=oneshot
ExecStart=-%s rcon -config %s "say Server restarting in 60 seconds"
ExecStart=/bin/sleep 50
ExecStart=-%s rcon -config %s "say Server restarting in 10 seconds"
ExecStart=/bin/sleep 10
ExecStart=/usr/bin/systemctl restart %s
`, slug, unit, execPath, configPath, execPath, configPath, unit)
}

func renderRestartTimer(slug, scheduleUTC string) string {
	return fmt.Sprintf(`[Unit]
Description=voz.gg game server restart timer (%s)

[Timer]
OnCalendar=*-*-* %s:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
`, slug, scheduleUTC)
}

// reconcileServerControl brings the game-server unit and optional restart timer
// into line with the capability. The password is passed in (already minted by
// ensureRconPassword) so this function never touches the agent config. It
// propagates RCON settings into the server's server.properties, then installs and
// enables the units. Disabling removes them. Note: it never restarts an
// already-running game server — RCON setting changes apply on the next restart,
// keeping reprovision non-disruptive to players.
func reconcileServerControl(sys systemOps, sc serverControlCapability, rconPassword string, rconPort int, execPath, configPath string, stdout io.Writer) error {
	slug := ""
	if sc.Slug != "" {
		s, err := sanitizeSlug(sc.Slug)
		if err != nil {
			if sc.Enabled {
				return err
			}
			return nil // disabled + unusable slug: nothing to remove
		}
		slug = s
	}

	if !sc.Enabled {
		if slug != "" {
			removeServerControlUnits(sys, slug)
		}
		return nil
	}
	if slug == "" {
		return errors.New("server control enabled but no slug provided")
	}
	if sc.WorkingDir == "" || sc.ServerUser == "" || sc.StartCommand == "" {
		return errors.New("server control enabled but serverUser/workingDir/startCommand are incomplete")
	}
	if !sys.hasSystemd() {
		fmt.Fprintln(stdout, "server control: systemd not found; skipping unit install")
		return nil
	}

	port := rconPort
	if port == 0 {
		port = defaultRconPort
	}

	// Propagate RCON settings into server.properties (key-preserving).
	propsPath := filepath.Join(sc.WorkingDir, "server.properties")
	existing := ""
	if sys.pathExists(propsPath) {
		raw, err := sys.readFile(propsPath)
		if err != nil {
			return fmt.Errorf("read %s: %w", propsPath, err)
		}
		existing = string(raw)
	}
	updated := setProperties(existing, map[string]string{
		"enable-rcon":           "true",
		"rcon.port":             strconv.Itoa(port),
		"rcon.password":         rconPassword,
		"broadcast-rcon-to-ops": "false",
	})
	if updated != existing {
		if err := sys.writeFile(propsPath, []byte(updated), 0o600); err != nil {
			return fmt.Errorf("write %s: %w", propsPath, err)
		}
		_ = sys.chownRecursive(propsPath, sc.ServerUser, sc.ServerUser)
	}

	// Render + install the gameserver unit.
	unit := renderServerControlUnit(execPath, slug, sc.ServerUser, sc.WorkingDir, sc.StartCommand, configPath)
	if err := sys.writeFile("/etc/systemd/system/"+serverControlUnitName(slug), []byte(unit), 0o644); err != nil {
		return err
	}

	// Restart timer (optional).
	if sc.RestartSchedule != "" {
		sched, err := validateSchedule(sc.RestartSchedule)
		if err != nil {
			return err
		}
		if err := sys.writeFile("/etc/systemd/system/"+restartServiceName(slug), []byte(renderRestartService(execPath, slug, configPath)), 0o644); err != nil {
			return err
		}
		if err := sys.writeFile("/etc/systemd/system/"+restartTimerName(slug), []byte(renderRestartTimer(slug, sched)), 0o644); err != nil {
			return err
		}
	} else {
		_ = sys.run("systemctl", "disable", "--now", restartTimerName(slug))
		_ = sys.remove("/etc/systemd/system/" + restartServiceName(slug))
		_ = sys.remove("/etc/systemd/system/" + restartTimerName(slug))
	}

	if err := sys.run("systemctl", "daemon-reload"); err != nil {
		return err
	}
	if err := sys.run("systemctl", "enable", "--now", serverControlUnitName(slug)); err != nil {
		return err
	}
	if sc.RestartSchedule != "" {
		if err := sys.run("systemctl", "enable", "--now", restartTimerName(slug)); err != nil {
			return err
		}
	}
	fmt.Fprintf(stdout, "voz-gg-agent server control installed for %s (unit %s)\n", slug, serverControlUnitName(slug))
	return nil
}

func removeServerControlUnits(sys systemOps, slug string) {
	for _, name := range []string{serverControlUnitName(slug), restartTimerName(slug), restartServiceName(slug)} {
		if sys.unitInstalled(name) {
			_ = sys.run("systemctl", "disable", "--now", name)
			_ = sys.remove("/etc/systemd/system/" + name)
		}
	}
	_ = sys.run("systemctl", "daemon-reload")
}
