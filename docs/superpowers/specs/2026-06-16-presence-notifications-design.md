# voz.gg #25c — Presence notifications (spec)

**Status:** Approved — open questions confirmed 2026-06-20 (triggers/cooldowns as designed; same-Worker consumer).
**Date:** 2026-06-16 (design) / 2026-06-20 (spec).
**Roadmap:** sub-project #7 "player presence & playtime", #25a (foundation, done) → #25b (management/views, done — PR #60/#63) → **#25c (this — notifications)**.
**Base:** `origin/main` at `baea9f8` (#64). Next migration number: **`0014`** (max on main is `0013`).
**Design source:** `~/dev/voz-notes/claude/2026-06-16-voz-gg-25c-presence-notifications-design.md`.

## Problem

#25a/#25b landed the presence pipeline and operator-facing player/server views with a
`status` (`new`/`allowed`/`blocked`) + informational `isBot` model. #25c adds **Discord
notifications** so operators learn about noteworthy presence events without watching the
dashboard, honoring that status/isBot model.

## Goals

- Notify a server's operators (via a per-server Discord webhook) about four classes of
  noteworthy presence events: first-sighting, new-player rejection, bot/muted escalation,
  blocked-then-returns.
- Decouple Discord delivery from presence ingest: a slow or failing Discord webhook must
  **never** block or fail `POST /presence`.
- Provide per-player muting to silence routine alerts for known bots/noise, while still
  escalating if a muted/bot player actually gets *in*.
- Business-level dedup/cooldown so operators are not spammed, plus an audit trail.

## Non-goals (out of scope)

- IP retention/purge — the user decided IPs are kept **indefinitely**; no purge mechanism.
- In-app notification feed; per-trigger UI toggles (the per-server webhook URL is the on/off).
- Channels other than Discord (email/SMS/etc.).
- Dead-letter-queue tooling beyond Cloudflare's built-in retry (see Delivery).

## Confirmed decisions

1. **Four triggers, all in scope** (table below).
2. **`muted` = a NEW per-player boolean**, distinct from informational `isBot`. Muting
   silences routine alerts; **escalation still fires** if a muted/bot player joins.
3. **Per-server `discordWebhookUrl`** (nullable text on `servers`). No URL ⇒ that server is
   silent (the URL doubles as the per-server on/off switch).
4. **Decoupled delivery via a Cloudflare Queue.** A queue handles delivery decoupling +
   retries; a `notification_log` table handles *business* dedup (once-ever / cooldown),
   retry-idempotency, and audit.
5. **Same-Worker consumer** — `events-ingest` exports both `fetch` (producer) and `queue`
   (consumer). One deploy, shared DAO/schema. (Confirmed 2026-06-20.)
6. **Trigger precedence + cooldown windows as tabled** — first-match-wins per event.
   (Confirmed 2026-06-20.)

## Triggers & semantics

Precedence top-to-bottom; **first match wins per event** (at most one alert per event).

| Trigger | Fires when | Anti-spam | Muted? |
|---|---|---|---|
| `bot_escalation` | `join` by player with `isBot` **or** `muted` | cooldown ~1h per (server,identity) | **fires anyway** (the alarm) |
| `blocked_return` | `join` **or** `connection_rejected` by `status='blocked'` | cooldown ~24h per (server,identity) | suppressed |
| `first_sighting` | `join` with **no prior join** for (server,identity) | once ever | suppressed |
| `new_player_rejection` | `connection_rejected` by `status='new'` | cooldown ~24h per (server,identity) | suppressed |

- Mute suppresses the routine three but **not** escalation — a known-bad actor getting *in*
  is precisely the thing to alarm on.
- Cooldown constants are tunable; ship with the values above (define as named constants in
  the shared module).

## Architecture (producer → queue → consumer)

```
voz-gg-agent logparse --POST /presence--> events-ingest (fetch)
                                              |  handlePresenceBatch (pure)
                                              |  -> notable events
                                              v
                                        NOTIFY_QUEUE.sendBatch
                                              |
                                              v
                                        events-ingest (queue)  <-- same Worker
                                              |  load player/server/log + prior-join check
                                              |  evaluateNotifications (pure)
                                              |  formatNotification (pure)
                                              v
                                        POST Discord webhook -> insert notification_log
```

### Producer (events-ingest `fetch`)

- `handlePresenceBatch` (pure, `libs/shared/src/presence.ts`) gains a return field:
  **`notable: NotableEvent[]`** — only **newly-inserted** (non-deduped) events of type
  `join` or `connection_rejected` that carry an identity (`identityKind` + `identityKey`).
  Never lifecycle (`server_start`/`server_stop`), never `leave`, never deduped events.
- `NotableEvent` shape (everything the consumer needs to evaluate + format, so it never
  re-reads the raw event row): `{ serverId, type, identityKind, identityKey, playerName,
  reason, occurredAt }` (`occurredAt` as epoch **seconds** to match the wire contract).
- The Worker calls `env.NOTIFY_QUEUE.sendBatch(...)` once for the batch's notable events,
  **awaited**, then returns the same ack body as today (`{ accepted, deduped, rejected }`).
  Enqueue is a fast local hop; ingest is never blocked on Discord.
- `handlePresenceBatch` stays **pure** (no queue dependency) — it returns `notable`; the
  Worker performs the enqueue. Empty `notable` ⇒ skip the `sendBatch` call.

### Consumer (events-ingest `queue`)

`queue(batch, env)` iterates messages; per message:

1. Load the **player** behind `(identityKind, identityKey)` → `status`, `isBot`, `muted`,
   `id` (for the dashboard link). If no player/identity row exists, ack (nothing to alert).
2. Load the **server** config → `discordWebhookUrl`. **No URL ⇒ ack (no-op).**
3. Load the relevant **notification_log** rows for `(serverId, identityKey)` to compute
   per-trigger "last sent at" / "ever sent".
4. For `first_sighting` candidates, compute **`hasPriorJoin`** = a `join` row exists for
   `(serverId, identityKey)` with `occurred_at` **strictly earlier** than this event's
   `occurredAt`. (Same-second duplicate joins for one identity collapse via `dedupeKey`, so
   strict-less-than is reliable.)
5. Run `evaluateNotifications(...)` (pure) → `PendingNotification[]` (0 or 1).
6. For each pending alert: `formatNotification(...)` → **POST the Discord webhook** →
   on success insert a `notification_log` row.

**Idempotency / at-least-once:** the cooldown/once-ever check against `notification_log`
is the dedup mechanism. Insert the log row **after** a successful Discord POST; on message
redelivery the existing row suppresses a duplicate send. (Trade-off: a crash between POST
success and log insert can re-send once — acceptable given cooldowns.)

**Discord failure handling** (mirrors `email.ts` throw-on-non-2xx):
- **2xx** → success; insert `notification_log`.
- **4xx** (bad/removed webhook URL) → log a warning and **ack** (drop; do not retry forever).
- **5xx / network error** → **throw** → Cloudflare retries the message (up to `max_retries`).

## Pure decision logic (`libs/shared/src/notifications.ts`)

No I/O. Fully unit-testable (fake-DAO style, as in `presence.test.ts` / `player-mutations.test.ts`).

```ts
export const NOTIFICATION_TRIGGERS = [
  'bot_escalation', 'blocked_return', 'first_sighting', 'new_player_rejection',
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

// Cooldown windows in seconds (tunable constants).
export const COOLDOWN_BOT_ESCALATION = 60 * 60;            // ~1h
export const COOLDOWN_BLOCKED_RETURN = 24 * 60 * 60;       // ~24h
export const COOLDOWN_NEW_PLAYER_REJECTION = 24 * 60 * 60; // ~24h
// first_sighting = once ever (no window)

export interface EvaluateInput {
  type: 'join' | 'connection_rejected';
  status: PlayerStatus;          // 'new' | 'allowed' | 'blocked'
  isBot: boolean;
  muted: boolean;
  hasPriorJoin: boolean;         // for (server, identity), strictly before this event
  occurredAt: number;            // epoch seconds
  lastSentAt: Partial<Record<NotificationTrigger, number>>; // epoch seconds per trigger
}

export interface PendingNotification { trigger: NotificationTrigger; }

export function evaluateNotifications(input: EvaluateInput): PendingNotification[];
export function formatNotification(args: FormatArgs): DiscordPayload;
```

- `evaluateNotifications` encodes precedence (first match wins), the mute rule (escalation
  ignores mute; the other three are suppressed when `muted`), and per-trigger cooldown /
  once-ever checks. Returns `[]` or a single-element array.
- `formatNotification(alert, { server, player, siteUrl })` → a Discord webhook payload
  (embed naming the server + player + trigger, with a link to `${siteUrl}/dashboard/players/<playerId>`).

## Data model (additive migration `0014` — backward-compatible, single deploy)

Generate with `cd apps/web && npx drizzle-kit generate`; additive so expand/contract is
satisfied automatically.

- **`player.muted`** — `integer('muted', { mode: 'boolean' }).notNull().default(false)`
  (mirror `isBot`).
- **`servers.discordWebhookUrl`** — `text('discord_webhook_url')` nullable (mirror the
  existing nullable `logParserEnabled` pattern on `servers`).
- **`notification_log`** — `(id, serverId, identityKind, identityKey, trigger, occurredAt)`.
  `serverId` FK → `servers` (`onDelete: 'cascade'`). Drives dedup/cooldown, retry-idempotency,
  and audit. Index on `(serverId, identityKey, trigger)`.
- **Composite index** on `presence_events (serverId, identityKey)` for the cheap prior-join
  check (today only `presence_events_server_id_idx` on `serverId` exists).

## Web UI (reuses #25b + D3 patterns)

- **`muted`** flows through the existing player mutation path:
  - `parsePlayerFieldsInput` + `handleUpdatePlayerFields` in `libs/shared/src/player-mutations.ts`
    (+ `player-mutations.test.ts`).
  - A toggle in `apps/web/src/components/dashboard/PlayerFieldsEditor.tsx` next to `isBot`,
    using the `switch.tsx` primitive from D3.
- **`discordWebhookUrl`** flows through the server form:
  - `apps/web/src/lib/server-schema.ts` (add a nullable/optional URL field; validate it's a
    Discord webhook-shaped URL or empty).
  - A text field in `apps/web/src/components/dashboard/ServerFormDialog.tsx` (mirror how
    `logParserEnabled` was wired in D3).
  - Persist in the servers `POST`/`PUT` API routes; pre-populate in
    `apps/web/src/pages/dashboard/servers.astro`.
- **Permissions:** `muted` and `discordWebhookUrl` are admin-only edits (match the existing
  admin-gating on player fields / server CRUD).

## Delivery / config

- Native `fetch` POST to the Discord webhook (matches `apps/web/src/lib/email.ts`: throw on
  non-2xx, but here the consumer maps 4xx→drop, 5xx/network→throw-to-retry).
- **events-ingest `wrangler.toml`** gains:
  - `[[queues.producers]]` binding `NOTIFY_QUEUE` → queue `voz-gg-notifications`.
  - `[[queues.consumers]]` for `voz-gg-notifications` (`max_retries = 3`,
    `max_batch_size`/`max_batch_timeout` at sensible small values; DLQ optional/deferred).
  - `[vars]` `SITE_URL` (e.g. `https://voz.gg`) for dashboard deep links.
- **`Env`** interface in `services/events-ingest/src/index.ts` gains
  `NOTIFY_QUEUE: Queue<NotifyMessage>` and `SITE_URL: string`.
- **Ops (one-time, manual):** `npx wrangler queues create voz-gg-notifications` before first
  deploy. Document in the plan / PR description.

## Testing

- **Shared (`libs/shared`):**
  - `evaluateNotifications` truth table — every trigger; mute suppression of the routine
    three; escalation-overrides-mute; each cooldown window (just inside vs just outside);
    first_sighting once-ever + `hasPriorJoin`; precedence (e.g. blocked + bot `join` →
    `bot_escalation` wins).
  - `formatNotification` — payload shape + dashboard link.
  - `handlePresenceBatch` returns the correct `notable` set (join/rejection with identity,
    newly-inserted only; excludes lifecycle/leave/deduped).
- **events-ingest:** `queue()` consumer wiring with a mocked Discord `fetch` + fake DAO —
  fire / no-fire (no webhook URL) / dedup-suppressed / 4xx-drop / 5xx-throw-retry /
  retry-idempotency (redelivery after a logged send does not re-POST).
- **Web:** build + lint + test; `muted` toggle and `discordWebhookUrl` field round-trip
  through the mutation/server-form paths.

## Acceptance criteria

1. A `join`/`connection_rejected` batch to `POST /presence` returns the same
   `{ accepted, deduped, rejected }` ack and is **never** delayed/failed by Discord.
2. Each trigger fires under its tabled condition and is suppressed by its cooldown/once-ever
   window and (for the routine three) by `muted`; `bot_escalation` fires even when muted.
3. Precedence holds: an event matching multiple triggers produces exactly one alert (the
   highest-precedence match).
4. A server with no `discordWebhookUrl` produces no notifications.
5. Discord 4xx drops the message without retry; 5xx/network triggers a queue retry; a
   redelivered message that was already delivered does not double-post.
6. Admins can toggle a player's `muted` and set a server's `discordWebhookUrl` via the
   existing UIs; both round-trip and persist.
7. Migration `0014` is additive and applies cleanly (`--local` and via deploy `--remote`).
8. Gate green: `nx run-many -t build,test,lint` (or `nx affected`) across `shared`,
   `events-ingest`, and `web`.

## Risks / notes

- **Queue local dev:** `wrangler dev` supports queues locally; consumer tests use mocks
  rather than a live queue.
- **At-least-once delivery** means the idempotency window above can, very rarely, re-post
  once. Cooldowns make this benign.
- **`web` is deploy-only** (Astro via wrangler, no `nx release` VERSION); `events-ingest` is
  a deployed Worker too. `feat(web)` / `feat(events-ingest)` commits drive deploy, not a
  publish bump.

## Build process

Subagent-driven (`superpowers:subagent-driven-development`): fresh subagent per coherent
unit, two-stage review (spec then code-quality) each, final whole-branch review, then
`superpowers:finishing-a-development-branch` → push + open a PR (merge-commit model, as
#25a/#25b landed).
