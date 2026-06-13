# voz-gg-agent host provisioning & capability foundation

**Date:** 2026-06-13
**Status:** Approved (design); pending spec review

## Problem

The current agent installer (`apps/web/public/install-agent.sh`) installs the
`status-monitor` daemon and runs it **as root** via systemd, with no dedicated
service account and no hardening. We want to:

1. Run the agent as a dedicated, unprivileged, **shared** service account
   (`voz-gg`) that future agents reuse.
2. Let operators choose the run-as user/group (with sensible defaults) and the
   OS account the game server runs under, configured in the web UI.
3. Grant each agent capability **only** the OS permissions it needs, derived
   from the server's game type — so a future log-parsing capability can read the
   game server's logs without the network prober ever gaining that access.
4. Lay the foundation so that when `mc-logparser` ships, the **same installer**
   adds it as another capability and updates permissions, with no rewrite.

## Key facts grounding the design

- **`status-monitor` is network-only.** Every prober (`slp`, `tcp`, `a2s`)
  works by `net.Dial`-ing `host:port`. It never reads the game server's files;
  at runtime it only reads/refreshes its own config at
  `/etc/voz-status-monitor/config.json`. So it needs **no** filesystem access to
  the game server and can run as a plain unprivileged user.
- A **secondary group matching the game server's user** buys the current agent
  nothing. It matters only for a *future* file-reading capability
  (`mc-logparser`). We therefore model it as a per-capability grant, not a
  blanket grant on the shared user.
- The installer runs as `curl -fsSL <site>/install-agent.sh | sh -s -- <token>`,
  so the **script** arrives on stdin via the pipe and cannot read interactive
  input from stdin. The provisioning **binary**, however, can open `/dev/tty`
  directly — so all interactivity lives in `voz-gg-agent setup`, not the shell.
  The shell is a thin bootstrap (detect OS/arch, download, `chmod`, exec).
- The web app / Worker **cannot enumerate the target host's accounts** or paths.
  So the web UI provides defaults; any host-specific discovery (e.g. scanning for
  the log directory, picking an existing user) happens interactively in
  `voz-gg-agent setup` via `/dev/tty` when a tty is present, falling back to
  flags/enroll/defaults otherwise.

## Decisions

| Decision | Choice |
| --- | --- |
| Packaging | **Single `voz-gg-agent` binary, one privilege-scoped systemd unit per enabled capability.** |
| Installer split | **Thin `install-agent.sh`** (detect OS/arch, download, `chmod`, exec) **+ a `voz-gg-agent setup` subcommand** that does all provisioning (enroll, users, configs, units, cleanup). |
| Interactivity | `setup` opens `/dev/tty` when present (confirm/scan/pick); non-interactive via flags/enroll/defaults otherwise. |
| Schema scope | **Reserve full plumbing now** (run-as user/group, game-server user, log path, per-capability enable flags). |
| Run-as default | Dedicated `voz-gg` system user + `voz-gg` group. |
| Game-server user default | Per game-type (`minecraft-*` → `minecraft`); blank for others. |
| `voz-gg` creation | Created as a **system** account if missing. |
| `gameServerUser` creation | **Non-creating** — warn and skip the grant if absent (never fabricate a game account). |
| Secondary group mechanism | systemd `SupplementaryGroups=` on the **log-parser unit only**, not `usermod` on the shared user. |
| No-TTY / automation | `setup --non-interactive` (auto-detected when no `/dev/tty`); flag/env overrides `--run-as-user` / `--run-as-group` / `--game-server-user`; hard fallback `voz-gg`. |
| Legacy installs | Best-effort cleanup of the old `voz-status-monitor` unit on upgrade. |

## Architecture

### `voz-gg-agent` binary (renamed from `status-monitor`)

The shipped `status-monitor` becomes capability `monitor` inside a new
`voz-gg-agent` binary with subcommands. The existing prober/agent/config code moves
under `monitor` unchanged.

| Now | Becomes |
| --- | --- |
| `services/status-monitor` (Go) | `voz-gg-agent` with `monitor` + reserved `logparse` subcommands |
| `/usr/local/bin/voz-status-monitor` | `/usr/local/bin/voz-gg-agent` |
| `/etc/voz-status-monitor/config.json` | `/etc/voz-gg-agent/monitor.json` |
| `voz-status-monitor.service` | `voz-gg-agent-monitor.service` |
| release tag `status-monitor-latest`, asset `status-monitor-<os>-<arch>` | `voz-gg-agent-latest`, asset `voz-gg-agent-<os>-<arch>` |

Subcommands:

- `voz-gg-agent setup --enrollment-token <tok> --worker-base-url <url> [overrides]`
  — the provisioning entrypoint the thin installer execs. It performs enroll,
  resolves the capability policy, creates the `voz-gg` account, writes each
  enabled capability's config + unit, enables them, and cleans up legacy units.
  Interactive over `/dev/tty` when present (confirm values, scan for log dir,
  pick an existing user); non-interactive otherwise. Idempotent — re-running it
  reconciles an existing install (the upgrade/repair path). JSON parsing,
  user/group creation, and unit templating all live here, in Go — not in shell.
- `voz-gg-agent monitor -config <path>` — the current daemon loop (network prober,
  status reporting, config refresh on hash change).
- `voz-gg-agent logparse -config <path>` — **reserved**; scaffolded but not
  implemented in this spec (returns "not implemented" / hidden). Folding the
  existing `tools/mc-logparser` in is future work. Its interactive log-directory
  scan (default: scan `/home/<gameServerUser>`) is part of `setup` and lands with
  this capability.

`setup` subsumes the previously-planned `-write-config` / `-print-provisioning`
bootstrap flags — there is no longer any provisioning JSON parsed in shell.

The runtime `Config` / `ServerConfig` structs are unchanged — provisioning data
is **not** persisted into the monitoring config; it is install-time only.

### Data model (`libs/shared/src/schema.ts`)

Add to `servers` (all nullable; null ⇒ fall back to `GAME_TYPE_DEFAULTS` ⇒ hard
default). Additive only → backward-compatible, single deploy.

```ts
runAsUser: text('run_as_user'),            // default 'voz-gg'
runAsGroup: text('run_as_group'),          // default 'voz-gg'
gameServerUser: text('game_server_user'),  // default per game type (e.g. 'minecraft')
logPath: text('log_path'),                 // reserved for logParser; default per game type
monitorEnabled: integer('monitor_enabled', { mode: 'boolean' }),     // default true
logParserEnabled: integer('log_parser_enabled', { mode: 'boolean' }),// default false
```

Plus a code-level map (no new table):

```ts
export const GAME_TYPE_DEFAULTS: Record<GameType, { gameServerUser?: string; logPath?: string }> = {
  'minecraft-java':    { gameServerUser: 'minecraft', logPath: '/home/minecraft/logs' },
  'minecraft-bedrock': { gameServerUser: 'minecraft', logPath: '/home/minecraft/logs' },
  'source':            {},
  'generic-tcp':       {},
  'unknown':           {},
};
```

`logPath` defaults are guesses operators edit; they are reserved (not consumed
until `mc-logparser` ships).

Migration: `cd apps/web && npx drizzle-kit generate`. Artifacts land in
`apps/web/drizzle/migrations`. Applied by `nx affected -t migrate` on deploy.

### Enroll policy (`apps/web/src/lib/agent-handlers.ts`, `agent-config.ts`)

The Worker computes a capability policy from the server's game type and the
stored fields, and returns it at the **top level** of the enroll response
(alongside `agentToken`, `config`, `configHash`) — *not* inside the opaque,
hashed `config`:

```jsonc
"provisioning": {
  "runAsUser": "voz-gg",
  "runAsGroup": "voz-gg",
  "capabilities": {
    "monitor":   { "enabled": true },
    "logParser": { "enabled": false, "gameServerUser": "minecraft", "logPath": "/home/minecraft/logs" }
  }
}
```

`logParser.enabled` is driven by `logParserEnabled` (default false). The group is
**not** computed server-side (the Worker does not know host groups); `setup`
resolves the game-server user's primary group on the host.

`/api/agents/config` (runtime refresh) is unchanged — it returns only the opaque
monitoring config.

### Thin installer (`apps/web/public/install-agent.sh`)

A ~20-line bootstrap with **no provisioning logic**:

1. Require root (or re-exec under `sudo`).
2. Detect OS/arch; download `voz-gg-agent-<os>-<arch>` from `voz-gg-agent-latest`
   to `/usr/local/bin/voz-gg-agent`; `chmod +x`.
3. `exec /usr/local/bin/voz-gg-agent setup --enrollment-token "<tok>"
   --worker-base-url "<origin>" "$@"` — handing the terminal to the binary so it
   can use `/dev/tty`.

The auto-generated copy/paste (`AgentInstallDialog`) carries only the
**enrollment token** (and origin); everything else is fetched via enroll or
resolved interactively. Power users can append flags (e.g. `--non-interactive`,
`--run-as-user`) which pass through to `setup`.

### `voz-gg-agent setup` (provisioning, in Go)

Idempotent, capability-driven. Per value, precedence is
**flag/env override > enroll `provisioning` > hard default (`voz-gg`)**.

1. POST `/api/agents/enroll` with the token; receive `agentToken`, `config`,
   `configHash`, and the `provisioning` policy.
2. Ensure shared account: create group `runAsGroup`, then user `runAsUser`, as a
   **system** account if missing
   (`useradd --system --no-create-home --shell /usr/sbin/nologin -g <group>`).
3. For each **enabled** capability, write its config + install a
   privilege-scoped unit:
   - **monitor** (`voz-gg-agent-monitor.service`): `User=voz-gg`, `Group=voz-gg`,
     hardening (`NoNewPrivileges=true`, `ProtectSystem=strict`,
     `ProtectHome=true`, `PrivateTmp=true`,
     `ReadWritePaths=/etc/voz-gg-agent`). No supplementary groups.
   - **logParser** (`voz-gg-agent-logparse.service`, only when enabled — *not in
     this spec's runtime path*): resolve the game-server user's primary group; if
     `gameServerUser` is absent, **warn and skip** this capability. Interactively
     scan `/home/<gameServerUser>` for the log directory (confirm/override via
     `/dev/tty`), defaulting to the enroll `logPath`. Unit gets
     `SupplementaryGroups=<group>`, `ReadOnlyPaths=<logPath>`, and relaxed
     `ProtectHome`. Only this unit gains the file access.
4. `chown -R runAsUser:runAsGroup /etc/voz-gg-agent`; config files stay `0600`.
5. `systemctl daemon-reload` then `enable --now` each installed unit.
6. **Upgrade cleanup:** if `voz-status-monitor.service` exists, `disable --now`
   and remove it (and the old binary/config dir) — best effort, ignore errors.

All JSON parsing, account creation, unit templating, and `/dev/tty` interaction
live here, in testable Go — the shell does none of it.

### UI (`apps/web` create/edit server form + API)

An "Agent host" section with text inputs, pre-filled from the selected game type:

- Run-as user (`voz-gg`), run-as group (`voz-gg`).
- Game-server user (game-type default, e.g. `minecraft`; clearable — blank means
  no future log grant).
- Log path (reserved; game-type default; help text: "used by log parsing once
  available").
- Log parsing enable toggle (off, disabled with "coming soon" until the
  capability ships).

The create/edit server API (`apps/web/src/pages/api/servers/index.ts`,
`[id].ts`) accepts and persists these fields, applying `GAME_TYPE_DEFAULTS` when
omitted.

## Least-privilege & forward-compat notes

- The shared `voz-gg` user holds **no** game-file access by default. Access is
  granted per capability via `SupplementaryGroups=` on that capability's unit, so
  enabling log parsing never widens the network prober's privileges.
- `ProtectHome=true` on the monitor unit is safe (no file access). The future
  log-parser unit deliberately relaxes it; that relaxation is scoped to the
  log-parser unit only.
- `logPath` is host-specific and cannot be derived by the Worker; it is an
  operator-entered field with a game-type default.

## Build sequence (single spec, phased)

1. **Schema + migration + `GAME_TYPE_DEFAULTS`** (`libs/shared`, `apps/web/drizzle`).
2. **Enroll policy** in the Worker (`agent-handlers.ts`, `agent-config.ts`).
3. **`voz-gg-agent` Go restructure**: rename `services/status-monitor` →
   `voz-gg-agent`, `monitor` subcommand wraps existing loop, reserved `logparse`,
   and the new **`setup`** subcommand (enroll, account creation, config/unit
   templating, `/dev/tty` interaction, legacy cleanup); update `project.json`,
   tags, and the release/CI workflow asset names + tag.
4. **Thin installer rewrite** (`install-agent.sh`): detect OS/arch, download,
   `chmod`, `exec voz-gg-agent setup …` — no provisioning logic in shell.
5. **UI form fields + server API** persistence.
6. **Docs**: update `AGENTS.md` (taxonomy: `voz-gg-agent` is the unified host
   agent; `status-monitor` capability lives inside it) and the install dialog
   copy.

## Testing

- **Go:** existing `status-monitor` tests move with the `monitor` capability and
  must still pass. For `setup`, unit-test the value-precedence resolution
  (flag/env > enroll > default), capability-skip when `gameServerUser` is absent,
  and unit-file rendering. Factor `setup`'s side effects (run command, write file,
  open `/dev/tty`) behind interfaces so the logic is testable without root or a
  real systemd; cover the privileged path with a manual checklist on a throwaway
  Linux box.
- **Worker:** unit-test the enroll handler emits the `provisioning` block with
  correct capability enablement per game type and applied `GAME_TYPE_DEFAULTS`.
- **Installer:** `sh -n` + shellcheck the thin bootstrap (OS/arch detection,
  download, exec). It carries no provisioning logic to test.
- **Schema:** migration applies cleanly (`web:migrate:local`) and is additive.

## Out of scope (future)

- Implementing the `logparse` capability (the actual log parser) and its
  interactive log-directory scan. This spec reserves the `setup` scan hook,
  subcommand, schema columns, enroll shape, and install path, but `setup` does
  not yet scan or install a logparse unit (enabled=false).
- Folding the existing `tools/mc-logparser` into `voz-gg-agent`.

## Open items resolved

- **Migration of existing `voz-status-monitor` installs:** handled via best-effort
  cleanup of the old unit on upgrade (no hard dependency on prior state).
