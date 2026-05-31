package prober

import (
	"context"
	"net"
	"testing"
	"time"
)

// buildStatusResponse frames a status JSON the way a Minecraft server does:
// outer VarInt length, packet id 0x00, VarInt JSON length, JSON bytes.
func buildStatusResponse(json string) []byte {
	var inner []byte
	inner = append(inner, encodeVarInt(0x00)...)
	inner = append(inner, encodeVarInt(len(json))...)
	inner = append(inner, []byte(json)...)
	return append(encodeVarInt(len(inner)), inner...)
}

func TestSLPParsesPlayersAndVersion(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	json := `{"version":{"name":"1.21","protocol":767},"players":{"online":12,"max":50},"description":{"text":"hi"}}`
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		// Drain handshake + status-request, then reply.
		buf := make([]byte, 256)
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		_, _ = conn.Read(buf)
		_, _ = conn.Write(buildStatusResponse(json))
	}()

	port := parsePort(t, ln.Addr().String())
	st, err := SLP{Timeout: 2 * time.Second}.Probe(context.Background(), "127.0.0.1", port, 0)
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if st.Status != "online" {
		t.Fatalf("status = %q, want online", st.Status)
	}
	if st.Players == nil || *st.Players != 12 {
		t.Fatalf("players = %v, want 12", st.Players)
	}
	if st.MaxPlayers == nil || *st.MaxPlayers != 50 {
		t.Fatalf("maxPlayers = %v, want 50", st.MaxPlayers)
	}
	if st.Version != "1.21" {
		t.Fatalf("version = %q, want 1.21", st.Version)
	}
}

func TestSLPOfflineWhenNothingListening(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := parsePort(t, ln.Addr().String())
	ln.Close()

	st, err := SLP{Timeout: 200 * time.Millisecond}.Probe(context.Background(), "127.0.0.1", port, 0)
	if err != nil {
		t.Fatalf("Probe returned error: %v", err)
	}
	if st.Status != "offline" {
		t.Fatalf("status = %q, want offline", st.Status)
	}
}

func TestEncodeDecodeVarIntRoundTrip(t *testing.T) {
	for _, v := range []int{0, 1, 127, 128, 255, 300, 25565, 2097151} {
		b := encodeVarInt(v)
		got, n, err := decodeVarInt(b, 0)
		if err != nil {
			t.Fatalf("decode %d: %v", v, err)
		}
		if got != v || n != len(b) {
			t.Fatalf("round-trip %d: got %d size %d (len %d)", v, got, n, len(b))
		}
	}
}
