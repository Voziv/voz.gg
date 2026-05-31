// Command status-monitor is a stub for the Minecraft server status reporter.
// Real ping logic arrives in the server-status-monitoring sub-project.
package main

import (
	"flag"
	"fmt"

	goshared "voz.gg/libs/go-shared"
)

// version is injected at build time via -ldflags "-X main.version=<v>",
// sourced from the project's VERSION file. It defaults to "dev" for local builds.
var version = "dev"

func statusEvent(host string) goshared.Event {
	return goshared.NewEvent(goshared.EventPlayerJoin, host)
}

func main() {
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	fmt.Println("status-monitor stub: daemon would poll game servers here")
}
