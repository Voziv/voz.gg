package main

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"io"
)

// jarVersion reads the embedded version.json from a (vanilla) server jar and
// returns its "id" — the canonical Minecraft version. Used by guided adoption to
// confidently identify an already-installed server before rearranging it.
func jarVersion(r io.ReaderAt, size int64) (string, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return "", err
	}
	for _, f := range zr.File {
		if f.Name != "version.json" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		defer rc.Close()
		var meta struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(rc).Decode(&meta); err != nil {
			return "", err
		}
		if meta.ID == "" {
			return "", errors.New("version.json has no id")
		}
		return meta.ID, nil
	}
	return "", errors.New("no version.json in jar")
}
