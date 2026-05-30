// Command mc-logparser is a stub CLI for the Minecraft log parser.
// `backfill` scans history once; `watch` tails the log as a daemon.
// Real parsing arrives in the log-parser sub-project.
package main

import (
	"fmt"
	"os"

	goshared "voz.gg/libs/go-shared"
)

func main() {
	cmd, err := resolveCommand(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	// Demonstrates the shared lib is importable from a tool in the same module.
	_ = goshared.NewEvent(goshared.EventPlayerJoin, "stub")
	fmt.Printf("mc-logparser stub: would run %q\n", cmd)
}
