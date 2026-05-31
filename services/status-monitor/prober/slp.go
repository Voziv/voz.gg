package prober

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net"
	"strconv"
	"time"
)

// maxPacketSize caps the advertised SLP packet length. It is well above any real
// status response, so a hostile server cannot force a large allocation by drip-
// feeding bytes against a huge advertised length.
const maxPacketSize = 128 * 1024

// SLP implements the Minecraft Java Server List Ping handshake, ported from the
// source TypeScript implementation in src/lib/status/minecraft.ts.
type SLP struct {
	Timeout time.Duration
}

func encodeVarInt(value int) []byte {
	v := uint32(value)
	var out []byte
	for {
		if v&^0x7f == 0 {
			return append(out, byte(v))
		}
		out = append(out, byte(v&0x7f)|0x80)
		v >>= 7
	}
}

func decodeVarInt(buf []byte, offset int) (value int, size int, err error) {
	var shift uint
	for {
		if offset+size >= len(buf) {
			return 0, 0, errors.New("varint out of bounds")
		}
		b := buf[offset+size]
		size++
		value |= int(b&0x7f) << shift
		if b&0x80 == 0 {
			return value, size, nil
		}
		shift += 7
		if shift >= 32 {
			return 0, 0, errors.New("varint too long")
		}
	}
}

func buildHandshakePacket(host string, port int) []byte {
	var data []byte
	data = append(data, encodeVarInt(0x00)...) // packet id
	data = append(data, encodeVarInt(-1)...)   // protocol version (-1)
	hostBytes := []byte(host)
	data = append(data, encodeVarInt(len(hostBytes))...)
	data = append(data, hostBytes...)
	portBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(portBuf, uint16(port))
	data = append(data, portBuf...)
	data = append(data, encodeVarInt(1)...) // next state: status
	return append(encodeVarInt(len(data)), data...)
}

func buildStatusRequestPacket() []byte {
	data := encodeVarInt(0x00)
	return append(encodeVarInt(len(data)), data...)
}

type slpResponse struct {
	Players *struct {
		Online *int `json:"online"`
		Max    *int `json:"max"`
	} `json:"players"`
	Version *struct {
		Name string `json:"name"`
	} `json:"version"`
}

func (p SLP) Probe(ctx context.Context, host string, port, _ int) (Status, error) {
	timeout := p.Timeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	dialer := net.Dialer{Timeout: timeout}
	start := time.Now()
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return Status{Status: "offline"}, nil
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	if _, err := conn.Write(buildHandshakePacket(host, port)); err != nil {
		return Status{Status: "offline"}, nil
	}
	if _, err := conn.Write(buildStatusRequestPacket()); err != nil {
		return Status{Status: "offline"}, nil
	}

	jsonBytes, err := readStatusJSON(conn)
	if err != nil {
		return Status{Status: "offline"}, nil
	}

	var parsed slpResponse
	if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
		return Status{Status: "offline"}, nil
	}

	latency := int(time.Since(start).Milliseconds())
	st := Status{Status: "online", LatencyMs: &latency}
	if parsed.Players != nil {
		st.Players = parsed.Players.Online
		st.MaxPlayers = parsed.Players.Max
	}
	if parsed.Version != nil {
		st.Version = parsed.Version.Name
	}
	return st, nil
}

// readStatusJSON reads bytes until a full VarInt-framed status packet is buffered,
// then returns just the JSON payload. Mirrors the incremental parse in the source TS.
func readStatusJSON(conn net.Conn) ([]byte, error) {
	buf := make([]byte, 0, 1024)
	tmp := make([]byte, 1024)
	for {
		// Try to parse what we have. As soon as the leading length VarInt decodes,
		// reject an oversized advertised length before buffering toward it.
		if pktLen, pktLenSize, perr := decodeVarInt(buf, 0); perr == nil {
			if pktLen < 0 || pktLen > maxPacketSize {
				return nil, errors.New("packet length exceeds limit")
			}
			if len(buf) >= pktLenSize+pktLen {
				off := pktLenSize
				pktID, idSize, err := decodeVarInt(buf, off)
				if err != nil {
					return nil, err
				}
				off += idSize
				if pktID != 0x00 {
					return nil, errors.New("unexpected packet id")
				}
				jsonLen, jsonLenSize, err := decodeVarInt(buf, off)
				if err != nil {
					return nil, err
				}
				off += jsonLenSize
				if len(buf) < off+jsonLen {
					return nil, errors.New("truncated json")
				}
				return buf[off : off+jsonLen], nil
			}
		}
		n, err := conn.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			continue
		}
		if err != nil {
			return nil, err
		}
	}
}
