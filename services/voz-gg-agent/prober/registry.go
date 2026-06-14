package prober

import "time"

const defaultTimeout = 3 * time.Second

// For returns the prober for a server's gameType. Adding a game is a one-line
// case here plus (optionally) a query-port default in EffectiveQueryPort.
func For(gameType string) Prober {
	switch gameType {
	case "minecraft-java":
		return SLP{Timeout: defaultTimeout}
	case "source":
		return A2S{Timeout: defaultTimeout}
	default:
		return TCP{Timeout: defaultTimeout}
	}
}

// EffectiveQueryPort resolves the UDP query port for a probe. An explicit
// queryPort always wins; otherwise Source falls back to the game port.
func EffectiveQueryPort(gameType string, port, queryPort int) int {
	if queryPort != 0 {
		return queryPort
	}
	return port
}
