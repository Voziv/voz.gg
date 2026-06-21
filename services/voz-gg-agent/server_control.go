package main

import (
	"crypto/rand"
	"encoding/base64"
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
