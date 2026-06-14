package logparse

import (
	"strconv"
	"strings"
	"time"
)

// TimeResolver turns a log line's "HH:MM:SS" into a UTC epoch second, advancing
// the day each time the clock jumps backward (midnight rollover within one file).
type TimeResolver struct {
	day      time.Time // local midnight of the current day (carries its location)
	lastSecs int       // seconds-of-day of the previous resolved line, -1 if none
}

func NewTimeResolver(anchor time.Time, loc *time.Location) *TimeResolver {
	y, m, d := anchor.In(loc).Date()
	return &TimeResolver{day: time.Date(y, m, d, 0, 0, 0, 0, loc), lastSecs: -1}
}

// Resolve converts an "HH:MM:SS" string (already extracted from the log prefix)
// to a UTC epoch second.
func (r *TimeResolver) Resolve(hhmmss string) (int64, bool) {
	parts := strings.Split(strings.TrimSpace(hhmmss), ":")
	if len(parts) != 3 {
		return 0, false
	}
	hour, hourErr := strconv.Atoi(parts[0])
	min, minErr := strconv.Atoi(parts[1])
	sec, secErr := strconv.Atoi(parts[2])
	if hourErr != nil || minErr != nil || secErr != nil ||
		hour < 0 || hour > 23 || min < 0 || min > 59 || sec < 0 || sec > 59 {
		return 0, false
	}
	secs := hour*3600 + min*60 + sec
	if r.lastSecs >= 0 && secs < r.lastSecs {
		r.day = r.day.AddDate(0, 0, 1)
	}
	r.lastSecs = secs
	return r.day.Add(time.Duration(secs) * time.Second).UTC().Unix(), true
}
