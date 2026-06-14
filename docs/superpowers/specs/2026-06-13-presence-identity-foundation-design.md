# Presence & identity foundation (#25a)

**Date:** 2026-06-13
**Status:** Approved (design); pending spec review
**Roadmap:** sub-project #7 "player presence & playtime", split into #25a (this), #25b (player management & views), #25c (notifications).

## Problem

Track who is on each Minecraft server and for how long, by parsing the server's
log, and build the unified-player identity layer the later UI and notifications
depend on. This sub-project lands the **backend + data foundation only**: the
event pipeline, the tables, the auto-create/auto-link logic, read-time
session/playtime derivation, and a bare players list to verify the data
end-to-end.

Out of scope here (later sub-projects): the rich player/server views, editable
name, notes, freeform groups, identity pills, merge UI (#25b); Discord-webhook
notifications and their rules (#25c).

## Dependency on agent host provisioning

This builds on `docs/superpowers/specs/2026-06-13-voz-gg-agent-host-provisioning-design.md`.
As of this writing the provisioning **web foundation is built** (the `servers`
columns `runAsUser`/`runAsGroup`/`gameServerUser`/`logPath`/`monitorEnabled`/
`logParserEnabled`, `GAME_TYPE_DEFAULTS`, `buildProvisioning`, the enroll
`provisioning` block, and server-input validation/persistence) but the **Go
restructure is not** — `services/status-monitor` has not yet become the unified
`voz-gg-agent` binary with `setup` / `logparse` subcommands.

The Go `logparse` daemon therefore cannot be built until that restructure lands.
The rest of #25a is independent of it. We split delivery into two PRs:

- **PR-1 (independent, on `main` now):** schema, `events-ingest` ingestion,
  identity auto-create/auto-link, session-derivation helper, `GET /api/players`,
  bare `/dashboard/players`. Verified with synthetic event batches — no Go agent
  required.
- **PR-2 (after the provisioning Go restructure):** the `voz-gg-agent logparse`
  daemon (parser, backfill/tail, batched reporting). The provisioning spec
  already reserves the `logparse` subcommand, the `setup` log-directory scan, the
  schema columns, and the enroll `provisioning.capabilities.logParser` block, so
  PR-2 fills in the daemon body and the `setup` scan, with no rewrite.

## Architecture (data flow)

```
voz-gg-agent logparse (Go, co-located per box)        [PR-2]
  ├─ backfill rolled logs/*.log.gz + tail logs/latest.log
  ├─ parse → join | leave | connection_rejected | server_start | server_stop
  └─ POST batches → events-ingest  (Bearer = shared per-server agent token)

events-ingest (TS Worker)                              [PR-1]
  ├─ validate token vs server_agent  (shared helper, extracted to libs/shared)
  ├─ append-only insert into presence_events  (idempotent, ON CONFLICT DO NOTHING)
  └─ ensure player + player_identity for minecraft UUID; auto-link to user account

apps/web (read)                                        [PR-1]
  └─ session/playtime derived at read time from presence_events
```

The log agent reuses the server's **existing per-server agent token** (the one
the status monitor already enrolled — one enrollment per box authorizes both
status and presence). `events-ingest` validates that token against the
`server_agent` table using a helper extracted from `apps/web` into `libs/shared`,
so both Workers validate identically.

Why a separate ingestion Worker (not `apps/web`): whitelist-scanning bots can
spam connection attempts; keeping that volume off the web Worker isolates the
load, and it honors the roadmap's `events-ingest` separation.

## Data model (`libs/shared/src/schema.ts`)

Additive only → backward-compatible, single deploy. Drizzle migration generated
with `cd apps/web && npx drizzle-kit generate`; artifacts in
`apps/web/drizzle/migrations`.

```ts
// raw, append-only event log
export const presenceEvents = sqliteTable('presence_events', {
  id: text('id').primaryKey(),                       // generated (nanoid)
  serverId: text('server_id').notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),                      // PRESENCE_EVENT_TYPES
  identityKind: text('identity_kind'),               // 'minecraft' | null (lifecycle)
  identityKey: text('identity_key'),                 // MC UUID | null (lifecycle)
  playerName: text('player_name'),                   // name at event time
  ip: text('ip'),                                    // present on connection_rejected
  reason: text('reason'),                            // e.g. 'whitelist' on rejected
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(), // UTC
  // deterministic idempotency key, computed at ingest. A plain composite UNIQUE
  // can't be used: SQLite treats NULL as distinct, so lifecycle events
  // (identity_key = NULL) would never dedupe on re-backfill. This NOT NULL key
  // coalesces the nullable identity, so every event type dedupes correctly.
  dedupeKey: text('dedupe_key').notNull().unique(),  // `${serverId}|${type}|${identityKey ?? ''}|${occurredAtEpochSeconds}`
});

export const PRESENCE_EVENT_TYPES = [
  'join', 'leave', 'connection_rejected', 'server_start', 'server_stop',
] as const;
export type PresenceEventType = (typeof PRESENCE_EVENT_TYPES)[number];

export const PLAYER_IDENTITY_KINDS = ['minecraft', 'steam', 'discord'] as const;
export type PlayerIdentityKind = (typeof PLAYER_IDENTITY_KINDS)[number];

// unified person across game identities
export const player = sqliteTable('player', {
  id: text('id').primaryKey(),
  displayName: text('display_name'),                 // defaults to latest MC name
  userId: text('user_id').references(() => user.id), // auto-linked when an account matches
  notes: text('notes'),                              // reserved; edited in #25b
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// one row per game identity; many per player
export const playerIdentity = sqliteTable('player_identity', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull()
    .references(() => player.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().$type<PlayerIdentityKind>(),
  identityKey: text('identity_key').notNull(),       // MC UUID
  displayName: text('display_name'),                 // latest in-game name seen
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}); // UNIQUE(kind, identity_key)
```

Lifecycle events (`server_start`/`server_stop`) carry null identity. `notes` and
the non-`minecraft` kinds exist in schema now but are only populated/edited in
#25b/#25c.

## Parser (`voz-gg-agent logparse`) — PR-2

Java vanilla-format log4j output (vanilla, NeoForge, Forge/NeoForge modpacks all
share it). Match on **message bodies**, robust to thread-name/prefix variation.

| Event | Matched on | Yields |
| --- | --- | --- |
| UUID binding | `UUID of player <name> is <uuid>` | name→UUID map (precedes join) |
| `join` | `<name> joined the game` | name (+ UUID from map) |
| `leave` | `<name> left the game` | name (+ last-known UUID for name) |
| `connection_rejected` | `GameProfile[id=<uuid>,name=<name>…] (/<ip>:port) lost connection: <reason>` | UUID, name, IP, reason (`whitelist` when reason matches "not white-listed"; otherwise the raw reason) |
| `server_start` | `Done (…)! For help, type "help"` | — |
| `server_stop` | `Stopping the server` | — |

The `UUID of player` line reliably precedes `joined the game`; the parser keeps a
short-lived name→UUID map to attach the UUID to the join, and `leave` reuses the
last-known UUID for that name. A join whose UUID was never seen is recorded with
`identityKey = null` and just the name.

### Timestamps & dates

Log lines carry only `[HH:MM:SS]`, local TZ. The agent is co-located, so its
local TZ matches the log's.

- **Rolled logs** `logs/YYYY-MM-DD-N.log.gz`: date from filename + `HH:MM:SS` →
  local → UTC epoch.
- **`latest.log`** (tail): anchor to the agent's current local date; detect
  midnight rollover when `HH:MM:SS` jumps backward and increment the day.
  Backfilling `latest.log` anchors to its file mtime date and walks the same wrap
  logic.

### Backfill + tail + checkpoint

On start the daemon **backfills** rolled + current logs, then **tails**
`latest.log`. A local **checkpoint** (last processed file + byte offset, in the
agent state dir) avoids reprocessing across restarts; the **idempotent unique
key** is the backstop so a re-read or overlapping batch never double-counts. On
rotation (new `latest.log`) the offset resets and tailing continues.

### Delivery

Events POST to `events-ingest` in **batches** (flush on N events or T seconds)
via the shared `Reporter` with the Bearer agent token. A failed POST retries with
backoff; the checkpoint advances **only on ack**, so delivery is at-least-once
and dedup happens at ingest.

## Ingest (`events-ingest` Worker) — PR-1

`POST /presence` (token-authed): validate the Bearer agent token against
`server_agent` (shared helper in `libs/shared`), resolve `serverId`, then for
each event in the batch:

1. Compute `dedupe_key = `${serverId}|${type}|${identityKey ?? ''}|${occurredAtEpochSeconds}`` and
   insert into `presence_events` with `ON CONFLICT(dedupe_key) DO NOTHING`.
2. For events with a `minecraft` UUID: **ensure** `player_identity(minecraft,
   uuid)` — if absent, create it plus a new `player` (`displayName` = event's
   `playerName`); if present, refresh `displayName` to the latest name seen.
3. **Auto-link:** if a `user` row has `minecraftUuid = uuid` and the player is
   not yet linked, set `player.userId`.

Returns `{ accepted, deduped }` counts so the agent can advance its checkpoint.
The existing `/health` endpoint stays.

## Session / playtime derivation (read-time, `libs/shared` TS helper) — PR-1

Pure function over a server's time-ordered events:

- Pair each `join` with the next `leave` for the same `identityKey` →
  `{ start, end }`.
- A `join` with no `leave` before the next `server_stop` / `server_start` → the
  session ends at that lifecycle event (crash cap).
- A `join` still open with the server up → an ongoing session ending at "now".
- Total playtime = Σ session durations; "last seen" = max event time; "servers
  seen on" = distinct `serverId`.
- Grouped to a **player** by unioning that player's `player_identity` keys, so
  alts/merges aggregate correctly once #25b merges exist.

## Read surface (minimal, to verify) — PR-1

- `GET /api/players` (apps/web): list of players with identity names, servers
  seen, last seen, total playtime.
- A bare `/dashboard/players` page rendering that list. No drill-in, sessions,
  notes, or groups — those are #25b.

## Testing

- **Go (PR-2):** table-driven parser tests for each line type, UUID correlation,
  midnight wrap, gzip rolled-log backfill, rotation, checkpoint advance/retry —
  real sample log snippets as fixtures. Side effects (file read, HTTP post,
  clock) behind interfaces.
- **Worker (PR-1):** ingest idempotency (re-post same batch → all deduped),
  player/identity auto-create, auto-link to account, token rejection.
- **Shared (PR-1):** session-derivation unit tests (clean pairs, dangling + cap,
  ongoing, multi-identity grouping); token-auth helper.
- **Schema (PR-1):** migration applies cleanly (`web:migrate:local`) and is
  additive.

## Build sequence

**PR-1 (now):**
1. Schema + migration (`presence_events`, `player`, `player_identity`) + extract
   token-auth/DAO helper to `libs/shared`.
2. `events-ingest` `/presence` endpoint (auth, idempotent insert, identity
   auto-create/link).
3. Session-derivation helper + `GET /api/players` + bare `/dashboard/players`.
4. Docs (AGENTS.md: presence pipeline + event taxonomy).

**PR-2 (after provisioning Go restructure):**
5. `voz-gg-agent logparse` daemon (parser → backfill/tail → checkpoint → batched
   report) + the `setup` log-directory scan.

## Out of scope (later sub-projects)

- #25b: player/server views, sessions drill-in, editable name, notes, freeform
  groups, identity pills, manual identity add, merge UI, bot/mute flags.
- #25c: Discord-webhook notifications (first-per-server sighting, new-player
  whitelist rejection, bot escalation) honoring per-player mute/bot flags.
