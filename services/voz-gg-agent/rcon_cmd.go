package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"voz.gg/services/voz-gg-agent/rcon"
)

// resolveRconCreds returns the RCON password and port. When propsPath is set it
// reads them from that server.properties file (used by the gameserver unit's
// ExecStop, which runs as the server user and can read its own properties but not
// the voz-gg-owned monitor.json). Otherwise it reads the agent config.
func resolveRconCreds(configPath, propsPath string) (string, int, error) {
	if propsPath != "" {
		raw, err := os.ReadFile(propsPath)
		if err != nil {
			return "", 0, err
		}
		content := string(raw)
		pw := readProperty(content, "rcon.password")
		if pw == "" {
			return "", 0, fmt.Errorf("no rcon.password in %s", propsPath)
		}
		port := defaultRconPort
		if p := readProperty(content, "rcon.port"); p != "" {
			if n, err := strconv.Atoi(p); err == nil {
				port = n
			}
		}
		return pw, port, nil
	}
	cfg, err := LoadConfig(configPath)
	if err != nil {
		return "", 0, err
	}
	if cfg.RCON.Password == "" {
		return "", 0, errors.New("no rcon password in config; is server control enabled?")
	}
	port := cfg.RCON.Port
	if port == 0 {
		port = defaultRconPort
	}
	return cfg.RCON.Password, port, nil
}

func runRcon(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("rcon", flag.ContinueOnError)
	fs.SetOutput(stderr)
	configPath := fs.String("config", defaultConfigPath, "path to the agent config json")
	propsPath := fs.String("properties", "", "read rcon password/port from a server.properties file instead of the config")
	host := fs.String("host", "127.0.0.1", "rcon host")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}

	password, port, err := resolveRconCreds(*configPath, *propsPath)
	if err != nil {
		fmt.Fprintf(stderr, "rcon: %v\n", err)
		return 1
	}
	addr := net.JoinHostPort(*host, strconv.Itoa(port))

	cmd := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if cmd != "" {
		out, err := rcon.Run(addr, password, cmd, 10*time.Second)
		if err != nil {
			fmt.Fprintf(stderr, "rcon: %v\n", err)
			return 1
		}
		fmt.Fprintln(stdout, strings.TrimRight(out, "\n"))
		return 0
	}

	// Interactive REPL: read a command per line until EOF.
	client, err := rcon.Dial(addr, password, 10*time.Second)
	if err != nil {
		fmt.Fprintf(stderr, "rcon: %v\n", err)
		return 1
	}
	defer client.Close()
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		out, err := client.Execute(line)
		if err != nil {
			fmt.Fprintf(stderr, "rcon: %v\n", err)
			return 1
		}
		fmt.Fprintln(stdout, strings.TrimRight(out, "\n"))
	}
	return 0
}
