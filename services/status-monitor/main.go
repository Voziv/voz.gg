// Command status-monitor is a stub for the Minecraft server status reporter.
// Real ping logic arrives in the server-status-monitoring sub-project.
package main

import (
	"fmt"

	goshared "voz.gg/libs/go-shared"
)

func statusEvent(host string) goshared.Event {
	return goshared.NewEvent(goshared.EventPlayerJoin, host)
}

func main() {
	fmt.Println("status-monitor stub: daemon would poll game servers here")
}
