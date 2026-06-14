package logparse

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
)

// Checkpoint records the last fully-acked read position in latest.log.
type Checkpoint struct {
	File   string `json:"file"`
	Offset int64  `json:"offset"`
}

func LoadCheckpoint(path string) (Checkpoint, error) {
	var cp Checkpoint
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return cp, nil
	}
	if err != nil {
		return cp, err
	}
	if err := json.Unmarshal(raw, &cp); err != nil {
		return cp, err
	}
	return cp, nil
}

func SaveCheckpoint(path string, cp Checkpoint) error {
	raw, err := json.Marshal(cp)
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}
