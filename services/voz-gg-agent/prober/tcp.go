package prober

import (
	"context"
	"net"
	"strconv"
	"time"
)

// TCP is the universal fallback prober: a successful connect means online.
type TCP struct {
	Timeout time.Duration
}

func (p TCP) Probe(ctx context.Context, host string, port, _ int) (Status, error) {
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
	latency := int(time.Since(start).Milliseconds())
	return Status{Status: "online", LatencyMs: &latency}, nil
}
