package prober

import (
	"context"
	"fmt"
	"net"
	"testing"
	"time"
)

func parsePort(t *testing.T, addr string) int {
	t.Helper()
	_, portStr, _ := net.SplitHostPort(addr)
	var port int
	if _, err := fmt.Sscan(portStr, &port); err != nil {
		t.Fatalf("parse port %q: %v", portStr, err)
	}
	return port
}

func TestTCPProberOnlineWhenListening(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()

	port := parsePort(t, ln.Addr().String())
	st, err := TCP{Timeout: time.Second}.Probe(context.Background(), "127.0.0.1", port, 0)
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if st.Status != "online" {
		t.Fatalf("status = %q, want online", st.Status)
	}
	if st.LatencyMs == nil {
		t.Fatal("expected latency to be set")
	}
}

func TestTCPProberOfflineWhenClosed(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := parsePort(t, ln.Addr().String())
	ln.Close() // nothing listening now

	st, err := TCP{Timeout: 200 * time.Millisecond}.Probe(context.Background(), "127.0.0.1", port, 0)
	if err != nil {
		t.Fatalf("Probe returned error (should report offline, not error): %v", err)
	}
	if st.Status != "offline" {
		t.Fatalf("status = %q, want offline", st.Status)
	}
}
