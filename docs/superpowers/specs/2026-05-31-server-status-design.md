---
date: 2026-05-31
feature: Live server status (co-located Go agent, probers, enrollment, status badge)
status: designed
sub_project: 6 of 7 (port-decomposition-roadmap; #6 split into #6 status + #7 presence)
---

# voz.gg — Live server status

## Context

Sub-project #6 in the port of `game-server-panel` into the `voz.gg` monorepo.
Builds on #4 (the `servers` table, `GameType`, dashboard) and #5 (admin server
CRUD). Replaces the placeholder `StatusBadge` with **live online/offline +
player-count** data.

The original roadmap #6 ("server status monitoring") was split during
brainstorming into **#6 (live status — this spec)** and **#7 (player presence &
playtime — separate spec)**. They share the co-located-agent deployment model
but are distinct data domains. A **CI/CD foundation** sub-project (separate spec)
delivers the GitHub Actions that publish the agent binary release and deploy the
Workers; #6 consumes the published release as an external dependency.

**Architecture decision (confirmed during brainstorming):** status is gathered
by a **co-located Go agent** — one `status-monitor` instance runs on each
physical game-server box, alongside the server it watches. It probes
`127.0.0.1:<port>` locally (sidestepping the edge-Worker-can't-reach-LAN
problem), then pushes status to a token-authed Worker endpoint. The Astro
servers page reads the stored status.

Existing scaffolding this fleshes out:
- `services/status-monitor` — a Go stub (`main.go` + test + nx project) importing
  `voz.gg/libs/go-shared`.
- `libs/go-shared` — has a `Reporter` that POSTs to a Worker with
  `Authorization: Bearer <token>` (only builds the request so far; gains a
  `Post`/`Send` here).
- Source `src/lib/status/minecraft.ts` — the Minecraft Java Server List Ping
  (SLP) protocol to port to Go.
- Single root `go.mod` (module `voz.gg`); Go projects import `voz.gg/<path>`.

## Decisions

- **Co-located agent, local probe.** Each agent probes `127.0.0.1:<port>`. The
  public `host` in the `servers` table stays display-only. **No new columns on
  `servers`.**
- **Prober selected from `gameType` in code** (not per-server config): a registry
  maps `gameType → prober`. Adding a new game = an enum value + a one-line
  mapping (the user will add games as they host them). v1 probers:
  `minecraft-java → SLP`, `source → A2S` (Steam/Source query — broad coverage),
  everything else → `tcp` connect liveness.
- **Per-server enrollment token.** Creating a server mints a one-time enrollment
  token (shown once in the UI with an install one-liner). The install script
  exchanges it for a long-lived **agent token**. Tokens are stored **hashed**.
- **Two new tables:** `server_status` (mutable snapshot, upserted per report) and
  `server_agent` (enrollment/agent token hashes + heartbeat). Distinct from the
  `servers` config table.
- **Config sync via hash handshake.** Each `POST /api/status` carries the agent's
  current opaque `configHash`; the response returns the latest. If they differ,
  the agent pulls fresh config. **Only the Worker computes the hash; the agent
  treats it as opaque** (no Go-vs-TS canonicalization mismatch).
- **Binary distribution = public GitHub Releases** (the repo is being made
  public; secret audit clean). The install script anonymously `curl`s the
  binary; the enrollment token gates only config + status (the sensitive part).
  The cross-compile/publish workflow is delivered by the CI/CD sub-project; for
  local testing a release is hand-cut.

## Goals

- The servers page shows real **Online · N/M / Offline / Unknown** per server.
- An admin can stand up an agent on a box with a single install command and have
  it reporting within one poll interval.
- Editing a server's settings in #5 propagates to its agent automatically (via
  the config-hash handshake) — no re-install.

## Non-goals (out of scope)

- **Player presence / time-played / online-timeline graph** → #7 (uses
  `mc-logparser` + `events-ingest`).
- **Bedrock UDP query, Satisfactory's protocol, per-game richer stats** — later
  prober additions (the registry makes them drop-in).
- **The release/deploy GitHub Actions** → CI/CD foundation sub-project (#6
  depends on a published release existing).
- A user-management/agent-management dashboard beyond the per-server enrollment
  controls.

## Architecture & components

### A. `status-monitor` Go agent — `services/status-monitor`

Replaces the stub. Responsibilities:
- Load a config file (default `/etc/voz-status-monitor/config.json`; path
  overridable by flag/env) containing: `workerBaseUrl`, `agentToken`, the cached
  server `config` (gameType/probeHost/port/queryPort/pollIntervalSeconds), and
  the last-seen `configHash`.
- Loop every `pollIntervalSeconds`:
  1. Select the prober for `config.gameType`; probe `config.probeHost:config.port`
     (default probeHost `127.0.0.1`), with the game's query port.
  2. `POST /api/status` with the probe result + the cached `configHash`.
  3. If the response `configHash` differs from the cached one → `GET
     /api/agents/config`, write the new config + hash to the config file, apply
     on the next cycle.
- Errors: a probe failure yields `status: "offline"` (still reported); a report
  HTTP failure is logged and retried next cycle with simple backoff. The agent
  never crashes on a transient error.

Files (indicative): `main.go` (wiring + loop), `config.go` (load/save), `agent.go`
(report/config-pull via `go-shared`), `prober/` (the probers + registry).

### B. Probers — `services/status-monitor/prober`

```go
type Status struct {
    Status     string // "online" | "offline" | "unknown"
    Players    *int
    MaxPlayers *int
    Version    string
    LatencyMs  *int
}

type Prober interface {
    Probe(ctx context.Context, host string, port, queryPort int) (Status, error)
}
```

- **`slp.go`** — Minecraft Java Server List Ping, ported from
  `src/lib/status/minecraft.ts`: VarInt handshake (protocol -1, host, port,
  next-state 1) + status request (0x00), read the VarInt-framed JSON, extract
  `players.online/max`, `version.name`, latency. Failure/timeout → offline.
- **`a2s.go`** — Source/Steam `A2S_INFO` (UDP): send the `T` query, handle the
  `S2C_CHALLENGE` (0x41) by resending with the challenge, parse the info response
  (name, map, players, max). Covers CS2, Valheim, Rust, etc.
- **`tcp.go`** — `net.DialTimeout` connect check → online/offline only. Universal
  fallback (Terraria, generic-tcp, unknown).
- **`registry.go`** — `func For(gameType string) Prober` mapping
  `minecraft-java→SLP`, `source→A2S`, default→TCP. The A2S query-port default is
  a per-gameType constant (falls back to the game port / `queryPort` when 0).

### C. `libs/go-shared` additions

- Add a `StatusReport` struct (the `POST /api/status` body) and an
  `EnrollResponse`/`AgentConfig` struct (shared shapes), OR keep request/response
  types in the agent and add only a transport helper. Decision: add a generic
  `func (r Reporter) Post(path string, payload any, out any) error` (builds the
  bearer request — already present — sends it, decodes JSON into `out`). The
  agent's status/enroll/config types live in the agent package.

### D. Schema — `libs/shared/src/schema.ts` (+ D1 migration)

```ts
export const serverStatus = sqliteTable('server_status', {
  serverId: text('server_id').primaryKey().references(() => servers.id, { onDelete: 'cascade' }),
  status: text('status').notNull(), // 'online' | 'offline' | 'unknown'
  players: integer('players'),
  maxPlayers: integer('max_players'),
  version: text('version'),
  latencyMs: integer('latency_ms'),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
});

export const serverAgent = sqliteTable('server_agent', {
  serverId: text('server_id').primaryKey().references(() => servers.id, { onDelete: 'cascade' }),
  enrollmentTokenHash: text('enrollment_token_hash'),
  agentTokenHash: text('agent_token_hash'),
  enrolledAt: integer('enrolled_at', { mode: 'timestamp' }),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
});
```

Generate D1 migration `0004`; apply `--local` (document `--remote` for prod).

### E. Worker endpoints — `apps/web/src/pages/api/`

All three self-authenticate via token (no session) and are added to the
middleware **public-path allowlist** (`apps/web/src/lib/route-protection.ts`):
`/api/agents/enroll`, `/api/agents/config`, `/api/status`.

- **`POST /api/agents/enroll`** — body `{ enrollmentToken }`. Hash it (SHA-256),
  find the `server_agent` row whose `enrollmentTokenHash` matches and that is not
  yet enrolled. Generate a random `agentToken`, store its hash, set `enrolledAt`,
  **null `enrollmentTokenHash`** (one-time use). Return `{ agentToken, config,
  configHash }`. Invalid/used token → 401.
- **`GET /api/agents/config`** — `Authorization: Bearer <agentToken>` → resolve
  the server by `agentTokenHash` → return `{ config, configHash }`.
- **`POST /api/status`** — `Authorization: Bearer <agentToken>` → resolve server
  → validate body `{ status, players?, maxPlayers?, version?, latencyMs?,
  configHash }` → upsert `server_status` (`checkedAt = now`), set
  `server_agent.lastSeenAt = now` → return `{ configHash }` (the current one).

**Config + hash** (`apps/web/src/lib/agent-config.ts`): `buildAgentConfig(server)`
returns `{ serverId, gameType, probeHost: '127.0.0.1', port, queryPort,
pollIntervalSeconds }`; `configHash(config)` = SHA-256 hex over a canonical
(sorted-key) JSON. Computed on the fly from the `servers` row, so a #5 edit
changes the hash automatically. Token hashing + `agentToken` resolution live in
`apps/web/src/lib/agent-auth.ts` (hash helper + `serverIdForToken`).

### F. Enrollment surfacing in #5 — `apps/web`

- Extend `POST /api/servers` (create): after inserting the server, create its
  `server_agent` row with a fresh enrollment token; return the token in the
  response.
- Add **`POST /api/servers/[id]/agent/regenerate`** (admin) — mint a new
  enrollment token (and invalidate the old agent token), returning the new token.
- Servers page / `ServerFormDialog`: on create, surface the **install one-liner**
  (`curl -fsSL <site>/install-agent.sh | sh -s -- <enrollmentToken>`) once, and a
  per-server **"Show install command / regenerate"** affordance. The token is
  shown only at mint time (we store only its hash).

### G. Install script — `apps/web/public/install-agent.sh`

Served as a static asset at `<site>/install-agent.sh` (same origin as the
Worker). Usage: `curl -fsSL <site>/install-agent.sh | sh -s -- <enrollmentToken>`.
Steps:
1. Detect OS/arch (`uname -s/-m`).
2. Download the matching binary from the **public GitHub Release**. Because the
   CI/CD foundation releases projects *independently*, `/releases/latest/` is not
   project-specific; the install script uses the stable moving-tag URL the release
   workflow maintains:
   `https://github.com/<owner>/voz.gg/releases/download/status-monitor-latest/status-monitor-<os>-<arch>`.
   Install to `/usr/local/bin/voz-status-monitor`.
3. `POST /api/agents/enroll` with the token → receive `{ agentToken, config }`;
   write `/etc/voz-status-monitor/config.json`.
4. Install + enable a `systemd` unit (`voz-status-monitor.service`) and start it.
Idempotent re-run supported (re-enroll requires a fresh token via regenerate).

### H. UI — real `StatusBadge` + servers page read

- `apps/web/src/components/dashboard/StatusBadge.tsx` becomes a props component:
  `{ status: 'online' | 'offline' | 'unknown'; players?: number; maxPlayers?: number }`.
  Render **Online · N/M** (emerald), **Offline** (red), **Unknown** (gray).
- `apps/web/src/pages/dashboard/servers.astro`: left-join `server_status`; per row
  compute the display status with **staleness** — if there is no status row or
  `now - checkedAt > staleThresholdMs` (≈ 3× the poll interval, e.g. 90s), show
  `unknown` rather than a frozen `online`. Pass props to `StatusBadge`.

## Data flow

admin creates server (#5) → `server_agent` row + enrollment token → admin runs
install one-liner on the box → script downloads binary (public release), enrolls
(→ agent token + config), installs service → agent loops: probe `127.0.0.1:port`
→ `POST /api/status` (+ configHash) → Worker upserts `server_status`, returns
latest configHash → on mismatch agent pulls `GET /api/agents/config` → servers
page reads `server_status` (with staleness) → `StatusBadge`.

## Config & report shapes

```jsonc
// GET /api/agents/config  →  { config, configHash }
{ "config": { "serverId": "...", "gameType": "minecraft-java", "probeHost": "127.0.0.1",
              "port": 25565, "queryPort": 0, "pollIntervalSeconds": 30 },
  "configHash": "<sha256hex>" }

// POST /api/status  request
{ "status": "online", "players": 12, "maxPlayers": 50, "version": "1.21",
  "latencyMs": 23, "configHash": "<sha256hex>" }
// POST /api/status  response
{ "configHash": "<sha256hex>" }
```

## Error handling

- Probe failure/timeout → `status: "offline"` (reported, not dropped).
- Report HTTP failure → logged, retried next cycle (simple backoff); agent stays
  up.
- Enrollment: invalid/used/missing token → 401; already-enrolled re-enroll
  requires a regenerated token.
- Bad `/api/status` body → 400; missing/invalid agent token on config/status →
  401.
- Stale `checkedAt` (dead agent) → badge shows `unknown`, never a frozen status.

## Security

- Enrollment token: random, **stored hashed**, **one-time** (consumed on enroll).
- Agent token: random, **stored hashed**, bearer; identifies the server (resolved
  from the token — the agent never sends a serverId). Revoke = regenerate.
- The three agent endpoints bypass session middleware but enforce their own token
  auth; added explicitly to the public-path allowlist.
- Probes are localhost-only.
- Binary is public (harmless); the sensitive paths (config, status) are
  token-gated.

## Testing / acceptance

- **Go** (`nx test status-monitor` / `nx test go-shared`): SLP parse against a
  captured Minecraft response; A2S parse against a captured payload (incl. the
  challenge round-trip); TCP prober against a local `net.Listen`; the
  `gameType→prober` registry; config load/save; the report loop against an
  `httptest` server (asserts status POST body + config-hash re-pull on mismatch);
  `go-shared` `Post` (bearer header + JSON decode).
- **TS** (`nx test web`): `configHash` determinism; token hashing +
  `serverIdForToken`; `/api/agents/enroll` (mint→consume, reject reused token),
  `/api/status` upsert + returned hash, `/api/agents/config`; `StatusBadge`
  render states; staleness computation.
- **Lint/build**: `nx lint web`, `nx build web`, `nx build status-monitor` pass.
- **Runtime smoke (local):** migration `0004` applies; create a server as admin →
  enrollment token returned + install command shown; hand-run the agent against a
  local game server (or a fake listener) → `server_status` upserts and the badge
  flips to Online · N/M; edit the server's port in #5 → next heartbeat's hash
  mismatches → agent pulls new config; stop the agent → after the stale window the
  badge shows Unknown.

## Files (indicative)

| path | action |
|------|--------|
| `libs/shared/src/schema.ts` | edit — add `server_status` + `server_agent` |
| `apps/web/drizzle/migrations` | add — generated `0004` |
| `apps/web/src/lib/agent-config.ts` (+ test) | create — `buildAgentConfig` + `configHash` |
| `apps/web/src/lib/agent-auth.ts` (+ test) | create — token hash + `serverIdForToken` |
| `apps/web/src/pages/api/agents/enroll.ts` | create — enroll |
| `apps/web/src/pages/api/agents/config.ts` | create — config pull |
| `apps/web/src/pages/api/status.ts` | create — status upsert |
| `apps/web/src/pages/api/servers/index.ts` | edit — mint enrollment token on create |
| `apps/web/src/pages/api/servers/[id]/agent/regenerate.ts` | create — regenerate (admin) |
| `apps/web/src/lib/route-protection.ts` | edit — allowlist the 3 agent paths |
| `apps/web/src/components/dashboard/StatusBadge.tsx` | edit — real props/states |
| `apps/web/src/components/dashboard/ServerFormDialog.tsx` (or a sibling) | edit — surface install command / token |
| `apps/web/src/pages/dashboard/servers.astro` | edit — join `server_status` + staleness |
| `apps/web/public/install-agent.sh` | create — install script |
| `services/status-monitor/{main,config,agent}.go` (+ tests) | replace stub — agent |
| `services/status-monitor/prober/{slp,a2s,tcp,registry}.go` (+ tests) | create — probers |
| `libs/go-shared/report.go` | edit — add `Post`/`Send` |

## Dependencies & sequencing

- Depends on #4 (`servers`, `GameType`, dashboard) and #5 (CRUD, admin role) —
  both on main.
- **External dependency:** a published GitHub Release containing the
  cross-compiled `status-monitor` binary, produced by the **CI/CD foundation**
  sub-project (specced in parallel). Until that exists, hand-cut a release
  (`nx build status-monitor` per target + `gh release create`) for testing.
- **#7 (presence & playtime)** reuses the co-located-agent + enrollment model and
  the `events-ingest` pipeline; it is independent of #6's status path.
- If the plan proves too large, the natural split is **6a:** schema + Worker
  endpoints + enrollment + real `StatusBadge` (TS-only, testable without a live
  agent), **6b:** the Go agent + probers + install script. Default: one plan;
  reassess at planning time.
