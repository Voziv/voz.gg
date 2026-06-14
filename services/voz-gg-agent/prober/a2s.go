package prober

import (
	"bytes"
	"context"
	"errors"
	"net"
	"strconv"
	"time"
)

// A2S implements the Steam/Source A2S_INFO query, handling the optional
// S2C_CHALLENGE (0x41) round-trip. Covers CS2, Valheim, Rust, etc.
type A2S struct {
	Timeout time.Duration
}

var a2sInfoPayload = append(
	[]byte{0xFF, 0xFF, 0xFF, 0xFF, 'T'},
	append([]byte("Source Engine Query"), 0)...,
)

func (p A2S) Probe(ctx context.Context, host string, _ int, queryPort int) (Status, error) {
	timeout := p.Timeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "udp", net.JoinHostPort(host, strconv.Itoa(queryPort)))
	if err != nil {
		return Status{Status: "offline"}, nil
	}
	defer conn.Close()
	deadline := time.Now().Add(timeout)
	_ = conn.SetDeadline(deadline)

	resp, err := a2sExchange(conn, a2sInfoPayload)
	if err != nil {
		return Status{Status: "offline"}, nil
	}

	// Challenge response: 0x41 header → resend with the 4-byte challenge appended.
	if len(resp) >= 9 && resp[4] == 0x41 {
		query := append(append([]byte{}, a2sInfoPayload...), resp[5:9]...)
		resp, err = a2sExchange(conn, query)
		if err != nil {
			return Status{Status: "offline"}, nil
		}
	}

	players, max, version, err := parseA2SInfo(resp)
	if err != nil {
		return Status{Status: "offline"}, nil
	}
	return Status{Status: "online", Players: intPtr(players), MaxPlayers: intPtr(max), Version: version}, nil
}

func a2sExchange(conn net.Conn, payload []byte) ([]byte, error) {
	if _, err := conn.Write(payload); err != nil {
		return nil, err
	}
	buf := make([]byte, 1500)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, err
	}
	return buf[:n], nil
}

// parseA2SInfo reads the S2A_INFO reply (header 0x49): protocol byte, then the
// NUL-terminated name/map/folder/game strings, appid (int16), then players + max bytes.
func parseA2SInfo(resp []byte) (players int, max int, version string, err error) {
	if len(resp) < 6 || resp[4] != 0x49 {
		return 0, 0, "", errors.New("not an A2S info reply")
	}
	pos := 5
	pos++ // protocol byte
	// name, map, folder, game
	for i := 0; i < 4; i++ {
		end := bytes.IndexByte(resp[pos:], 0)
		if end < 0 {
			return 0, 0, "", errors.New("truncated string field")
		}
		pos += end + 1
	}
	if pos+4 > len(resp) {
		return 0, 0, "", errors.New("truncated before counts")
	}
	pos += 2 // appid int16
	players = int(resp[pos])
	max = int(resp[pos+1])
	return players, max, "", nil
}
