package prober

import (
	"context"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

func a2sInfoReply(name, mapName string, players, max byte) []byte {
	out := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0x49} // header + 'I'
	out = append(out, 17)                       // protocol
	out = append(out, []byte(name)...)
	out = append(out, 0)
	out = append(out, []byte(mapName)...)
	out = append(out, 0)
	out = append(out, []byte("folder")...)
	out = append(out, 0)
	out = append(out, []byte("game")...)
	out = append(out, 0)
	appid := make([]byte, 2)
	binary.LittleEndian.PutUint16(appid, 730)
	out = append(out, appid...)
	out = append(out, players, max)
	return out
}

func TestA2SParsesInfoWithChallengeRoundTrip(t *testing.T) {
	addr, _ := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		t.Fatalf("listen udp: %v", err)
	}
	defer conn.Close()

	go func() {
		buf := make([]byte, 1500)
		// First request → respond with a challenge (0x41 + 4 bytes).
		n, from, err := conn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		_ = n
		challenge := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0x41, 0x11, 0x22, 0x33, 0x44}
		conn.WriteToUDP(challenge, from)
		// Second request (with challenge) → respond with the info reply.
		_, from2, err := conn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		conn.WriteToUDP(a2sInfoReply("My CS2 Server", "de_dust2", 7, 24), from2)
	}()

	port := conn.LocalAddr().(*net.UDPAddr).Port
	st, err := A2S{Timeout: 2 * time.Second}.Probe(context.Background(), "127.0.0.1", 0, port)
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if st.Status != "online" {
		t.Fatalf("status = %q, want online", st.Status)
	}
	if st.Players == nil || *st.Players != 7 {
		t.Fatalf("players = %v, want 7", st.Players)
	}
	if st.MaxPlayers == nil || *st.MaxPlayers != 24 {
		t.Fatalf("maxPlayers = %v, want 24", st.MaxPlayers)
	}
}

func TestA2SParsesInfoWithoutChallenge(t *testing.T) {
	addr, _ := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	conn, _ := net.ListenUDP("udp", addr)
	defer conn.Close()

	go func() {
		buf := make([]byte, 1500)
		_, from, err := conn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		conn.WriteToUDP(a2sInfoReply("Valheim", "world", 2, 10), from)
	}()

	port := conn.LocalAddr().(*net.UDPAddr).Port
	st, err := A2S{Timeout: 2 * time.Second}.Probe(context.Background(), "127.0.0.1", 0, port)
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if st.Players == nil || *st.Players != 2 || st.MaxPlayers == nil || *st.MaxPlayers != 10 {
		t.Fatalf("players/max = %v/%v, want 2/10", st.Players, st.MaxPlayers)
	}
}

func TestA2SOfflineWhenNoServer(t *testing.T) {
	addr, _ := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	conn, _ := net.ListenUDP("udp", addr)
	port := conn.LocalAddr().(*net.UDPAddr).Port
	conn.Close() // nothing listening

	st, err := A2S{Timeout: 200 * time.Millisecond}.Probe(context.Background(), "127.0.0.1", 0, port)
	if err != nil {
		t.Fatalf("Probe returned error: %v", err)
	}
	if st.Status != "offline" {
		t.Fatalf("status = %q, want offline", st.Status)
	}
}
