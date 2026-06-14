package logparse

import (
	"bufio"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const LatestLog = "latest.log"

var rolledRe = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})-(\d+)\.log\.gz$`)

// Source enumerates and reads a Minecraft server's log directory.
type Source struct{ dir string }

func NewSource(dir string) *Source { return &Source{dir: dir} }

// RolledThenLatest returns rolled *.log.gz (date then numeric index order)
// followed by latest.log when present. Absolute paths.
func (s *Source) RolledThenLatest() ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	type rolled struct {
		name string
		date string
		idx  int
	}
	var rolls []rolled
	hasLatest := false
	for _, e := range entries {
		if e.Name() == LatestLog {
			hasLatest = true
			continue
		}
		if m := rolledRe.FindStringSubmatch(e.Name()); m != nil {
			idx, _ := strconv.Atoi(m[2])
			rolls = append(rolls, rolled{e.Name(), m[1], idx})
		}
	}
	sort.Slice(rolls, func(i, j int) bool {
		if rolls[i].date != rolls[j].date {
			return rolls[i].date < rolls[j].date
		}
		return rolls[i].idx < rolls[j].idx
	})
	var out []string
	for _, r := range rolls {
		out = append(out, filepath.Join(s.dir, r.name))
	}
	if hasLatest {
		out = append(out, filepath.Join(s.dir, LatestLog))
	}
	return out, nil
}

// ReadLines reads path starting at byte offset, invoking fn per line (newline
// trimmed), and returns the new byte offset. A .gz file is always read whole
// (offset ignored) and returns offset 0. On error the original offset is
// returned unchanged so the caller can keep its last good position.
func (s *Source) ReadLines(path string, offset int64, fn func(string)) (int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return offset, err
	}
	defer f.Close()

	var reader io.Reader = f
	gzipped := strings.HasSuffix(path, ".gz")
	if gzipped {
		gz, err := gzip.NewReader(f)
		if err != nil {
			return offset, err
		}
		defer gz.Close()
		reader = gz
	} else if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			return offset, err
		}
	}

	sc := bufio.NewScanner(reader)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	read := offset
	for sc.Scan() {
		read += int64(len(sc.Bytes())) + 1 // +1 for the \n terminator; \r\n files are not supported
		fn(sc.Text())
	}
	if gzipped {
		return 0, sc.Err()
	}
	return read, sc.Err()
}
