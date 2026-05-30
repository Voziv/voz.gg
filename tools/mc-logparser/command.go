package main

import "fmt"

// resolveCommand validates the first CLI argument against the supported
// subcommands. backfill = one-shot history scan; watch = long-running daemon.
func resolveCommand(args []string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("usage: mc-logparser <backfill|watch>")
	}
	switch args[0] {
	case "backfill", "watch":
		return args[0], nil
	default:
		return "", fmt.Errorf("unknown command %q (want backfill or watch)", args[0])
	}
}
