package main

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
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
