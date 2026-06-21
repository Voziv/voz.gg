package main

import (
	"crypto/rand"
	"encoding/base64"
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
