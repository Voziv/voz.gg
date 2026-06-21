# Presence Notifications (#25c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send per-server Discord notifications for four classes of noteworthy presence events (first-sighting, new-player rejection, bot/muted escalation, blocked-then-returns), decoupled from presence ingest via a Cloudflare Queue.

**Architecture:** `events-ingest` becomes both producer and consumer of a `voz-gg-notifications` queue. The `fetch` handler enqueues "notable" events returned by `handlePresenceBatch`; the same Worker's `queue` handler loads player/server/log state, runs a pure decision function, POSTs the Discord webhook, and records a `notification_log` row for dedup/audit. All decision and orchestration logic is pure and lives in `libs/shared` (unit-tested with fake DAOs); the Worker is thin wiring.

**Tech Stack:** TypeScript, Cloudflare Workers + Queues, D1, Drizzle ORM, Zod, Vitest, React (Astro islands), Base UI.

## Global Constraints

- **Base:** branch off `origin/main` at `baea9f8` (#64). This plan's worktree is `presence-notifications-25c`.
- **Next migration number is `0014`** (max on `main` is `0013`). Generate via `cd apps/web && npx drizzle-kit generate`; never hand-number.
- **Migrations are additive only** (expand/contract): new nullable column, new column with default, new table, new index. No destructive change.
- **Commits:** conventional `<type>(<scope>): <subject>`, imperative, ≤50 chars, no trailing period. Always `git commit -s` (DCO mandatory). `--no-verify` is policy-blocked — do not use it. Scopes here: `shared`, `events-ingest`, `web`.
- **Worktree signing:** `commit.gpgsign` is already set `false` for this worktree; commits are re-signed at branch finish via rebase `--exec`.
- **Outbound HTTP pattern:** native `fetch`, inspect `response.status` (mirror `apps/web/src/lib/email.ts`).
- **All testable logic lives in `libs/shared`** (`nx test shared`). `events-ingest` has no test target — it is verified by `nx build events-ingest` (tsc `--noEmit`).
- **Cooldown windows (seconds):** `bot_escalation` 3600, `blocked_return` 86400, `new_player_rejection` 86400, `first_sighting` once-ever.
- **Ops (one-time, before first deploy):** `cd services/events-ingest && npx wrangler queues create voz-gg-notifications`. Note in the PR description.

## Canonical types (defined in Task 2 + Task 4, referenced throughout)

```ts
// libs/shared/src/notifications.ts
export const NOTIFICATION_TRIGGERS = [
  'bot_escalation', 'blocked_return', 'first_sighting', 'new_player_rejection',
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

export interface EvaluateInput {
  type: 'join' | 'connection_rejected';
  status: PlayerStatus;                 // from './schema'
  isBot: boolean;
  muted: boolean;
  hasPriorJoin: boolean;                // a join exists for (server,identity) strictly before this event
  occurredAt: number;                   // epoch seconds
  lastSentAt: Partial<Record<NotificationTrigger, number>>; // epoch seconds per trigger
}
export interface PendingNotification { trigger: NotificationTrigger; }

export interface DiscordPayload { content?: string; embeds?: DiscordEmbed[]; }
export interface FormatArgs {
  trigger: NotificationTrigger;
  serverName: string;
  playerName: string;
  playerId: string;
  siteUrl: string;
  reason: string | null;
}

export interface NotifyMessage {
  serverId: string;
  type: 'join' | 'connection_rejected';
  identityKind: PlayerIdentityKind;     // from './schema'
  identityKey: string;
  playerName: string | null;
  reason: string | null;
  occurredAt: number;                   // epoch seconds
}

export interface NotificationDao {
  loadPlayer(kind: PlayerIdentityKind, key: string): Promise<{
    id: string; displayName: string | null; status: PlayerStatus; isBot: boolean; muted: boolean;
  } | null>;
  loadServer(serverId: string): Promise<{ name: string; discordWebhookUrl: string | null } | null>;
  lastSentByTrigger(serverId: string, identityKey: string): Promise<Partial<Record<NotificationTrigger, number>>>;
  hasPriorJoin(serverId: string, identityKey: string, beforeEpochSeconds: number): Promise<boolean>;
  recordNotification(row: {
    serverId: string; identityKind: PlayerIdentityKind; identityKey: string;
    trigger: NotificationTrigger; occurredAt: number;
  }): Promise<void>;
}

export type DiscordPost = (url: string, payload: DiscordPayload) => Promise<{ status: number }>;
```

---

### Task 1: Schema + migration 0014

**Files:**
- Modify: `libs/shared/src/schema.ts` (player table ~218-227, servers table ~95-114; add `notificationLog` table + a `presence_events` composite index)
- Create: `apps/web/drizzle/migrations/0014_*.sql` (generated)

**Interfaces:**
- Produces: `player.muted` (boolean, default false), `servers.discordWebhookUrl` (nullable text), `notificationLog` table, `presence_events_server_id_identity_key_idx`.

- [ ] **Step 1: Add `muted` to the player table**

In `libs/shared/src/schema.ts`, the `player` table — add `muted` right after `isBot`:

```ts
  isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
  muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
```

- [ ] **Step 2: Add `discordWebhookUrl` to the servers table**

In the `servers` table, after `logParserEnabled`:

```ts
  logParserEnabled: integer('log_parser_enabled', { mode: 'boolean' }),
  discordWebhookUrl: text('discord_webhook_url'),
```

- [ ] **Step 3: Add the `notification_log` table + composite index**

After the `presenceEvents` table definition, add the composite index to its index array, then add the table. First, update the `presenceEvents` index array (currently `[index('presence_events_server_id_idx').on(table.serverId)]`):

```ts
}, (table) => [
  index('presence_events_server_id_idx').on(table.serverId),
  index('presence_events_server_id_identity_key_idx').on(table.serverId, table.identityKey),
]);
```

Then add the new table (place it near the bottom, after `playerGroupTag`). `NOTIFICATION_TRIGGERS` is added in Task 2 — for now type the column with a string literal union inline to avoid a cross-file dependency cycle, since the schema module must not import from `notifications.ts`:

```ts
export const NOTIFICATION_TRIGGERS = [
  'bot_escalation', 'blocked_return', 'first_sighting', 'new_player_rejection',
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

// Business-level dedup/cooldown + audit for Discord presence notifications.
export const notificationLog = sqliteTable(
  'notification_log',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    identityKind: text('identity_kind').notNull().$type<PlayerIdentityKind>(),
    identityKey: text('identity_key').notNull(),
    trigger: text('trigger').notNull().$type<NotificationTrigger>(),
    occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('notification_log_lookup_idx').on(table.serverId, table.identityKey, table.trigger)],
);
```

> Note: `NOTIFICATION_TRIGGERS` is defined here in `schema.ts` (the constants/enums home, alongside `PLAYER_STATUSES`). Task 2 re-exports it from `notifications.ts` rather than redefining it.

- [ ] **Step 4: Verify the schema compiles**

Run: `nx build shared`
Expected: PASS (tsc clean).

- [ ] **Step 5: Generate the migration**

Run: `cd apps/web && npx drizzle-kit generate`
Expected: creates `apps/web/drizzle/migrations/0014_*.sql` containing `ALTER TABLE player ADD muted`, `ALTER TABLE servers ADD discord_webhook_url`, `CREATE TABLE notification_log`, and the two `CREATE INDEX` statements. Inspect the file to confirm it is additive only (no DROP/rename).

- [ ] **Step 6: Apply locally**

Run: `cd apps/web && npx wrangler d1 migrations apply voz-gg --local`
Expected: applies `0014` with no error.

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/schema.ts apps/web/drizzle/migrations/
git commit -s -m "feat(shared): add muted, webhook url, notification_log schema"
```

---

### Task 2: Pure notification decision + format logic

**Files:**
- Create: `libs/shared/src/notifications.ts`
- Create: `libs/shared/src/notifications.test.ts`

**Interfaces:**
- Consumes: `PlayerStatus`, `PlayerIdentityKind`, `NotificationTrigger` from `./schema`.
- Produces: `evaluateNotifications`, `formatNotification`, cooldown constants, `EvaluateInput`, `PendingNotification`, `DiscordPayload`, `FormatArgs`, `DiscordEmbed` (see Canonical types).

- [ ] **Step 1: Write the failing tests**

Create `libs/shared/src/notifications.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateNotifications, formatNotification, type EvaluateInput } from './notifications';

const base: EvaluateInput = {
  type: 'join',
  status: 'new',
  isBot: false,
  muted: false,
  hasPriorJoin: false,
  occurredAt: 1_000_000,
  lastSentAt: {},
};
const trig = (i: Partial<EvaluateInput>) =>
  evaluateNotifications({ ...base, ...i }).map((p) => p.trigger);

describe('evaluateNotifications', () => {
  it('fires first_sighting on a first join', () => {
    expect(trig({ status: 'allowed' })).toEqual(['first_sighting']);
  });
  it('does not fire first_sighting when a prior join exists', () => {
    expect(trig({ status: 'allowed', hasPriorJoin: true })).toEqual([]);
  });
  it('fires first_sighting only once ever (cooldown via lastSentAt)', () => {
    expect(trig({ status: 'allowed', lastSentAt: { first_sighting: 500_000 } })).toEqual([]);
  });
  it('fires new_player_rejection on a rejected new player', () => {
    expect(trig({ type: 'connection_rejected', status: 'new' })).toEqual(['new_player_rejection']);
  });
  it('respects the 24h cooldown on new_player_rejection', () => {
    const last = base.occurredAt - 86_399;
    expect(trig({ type: 'connection_rejected', status: 'new', lastSentAt: { new_player_rejection: last } })).toEqual([]);
    const old = base.occurredAt - 86_400;
    expect(trig({ type: 'connection_rejected', status: 'new', lastSentAt: { new_player_rejection: old } })).toEqual(['new_player_rejection']);
  });
  it('fires blocked_return on a blocked join or rejection', () => {
    expect(trig({ status: 'blocked' })).toEqual(['blocked_return']);
    expect(trig({ type: 'connection_rejected', status: 'blocked' })).toEqual(['blocked_return']);
  });
  it('fires bot_escalation when an isBot player joins', () => {
    expect(trig({ status: 'allowed', isBot: true })).toEqual(['bot_escalation']);
  });
  it('fires bot_escalation when a muted player joins, despite mute', () => {
    expect(trig({ status: 'allowed', muted: true })).toEqual(['bot_escalation']);
  });
  it('bot_escalation wins precedence over blocked_return on a bot+blocked join', () => {
    expect(trig({ status: 'blocked', isBot: true })).toEqual(['bot_escalation']);
  });
  it('mutes the routine triggers (no escalation on a rejection)', () => {
    expect(trig({ type: 'connection_rejected', status: 'new', muted: true })).toEqual([]);
    expect(trig({ status: 'blocked', type: 'connection_rejected', muted: true })).toEqual([]);
    expect(trig({ status: 'allowed', muted: true, type: 'connection_rejected' })).toEqual([]);
  });
  it('respects the 1h cooldown on bot_escalation', () => {
    const last = base.occurredAt - 3599;
    expect(trig({ status: 'allowed', isBot: true, lastSentAt: { bot_escalation: last } })).toEqual([]);
  });
  it('returns nothing for an allowed rejection that matches no trigger', () => {
    expect(trig({ type: 'connection_rejected', status: 'allowed' })).toEqual([]);
  });
});

describe('formatNotification', () => {
  it('builds an embed with a dashboard link', () => {
    const payload = formatNotification({
      trigger: 'first_sighting',
      serverName: 'Survival',
      playerName: 'Steve',
      playerId: 'p1',
      siteUrl: 'https://voz.gg',
      reason: null,
    });
    expect(payload.embeds?.[0]?.url).toBe('https://voz.gg/dashboard/players/p1');
    expect(JSON.stringify(payload)).toContain('Survival');
    expect(JSON.stringify(payload)).toContain('Steve');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `nx test shared`
Expected: FAIL — `notifications.ts` does not exist.

- [ ] **Step 3: Implement `notifications.ts`**

Create `libs/shared/src/notifications.ts`:

```ts
import type { PlayerStatus, PlayerIdentityKind, NotificationTrigger } from './schema';

export { NOTIFICATION_TRIGGERS } from './schema';
export type { NotificationTrigger } from './schema';

export const COOLDOWN_BOT_ESCALATION = 60 * 60; // 1h
export const COOLDOWN_BLOCKED_RETURN = 24 * 60 * 60; // 24h
export const COOLDOWN_NEW_PLAYER_REJECTION = 24 * 60 * 60; // 24h

export interface EvaluateInput {
  type: 'join' | 'connection_rejected';
  status: PlayerStatus;
  isBot: boolean;
  muted: boolean;
  hasPriorJoin: boolean;
  occurredAt: number;
  lastSentAt: Partial<Record<NotificationTrigger, number>>;
}

export interface PendingNotification {
  trigger: NotificationTrigger;
}

function fire(
  input: EvaluateInput,
  trigger: NotificationTrigger,
  cooldownSeconds: number | null,
): PendingNotification[] {
  const last = input.lastSentAt[trigger];
  if (cooldownSeconds === null) {
    return last == null ? [{ trigger }] : []; // once ever
  }
  return last == null || input.occurredAt - last >= cooldownSeconds ? [{ trigger }] : [];
}

// Precedence: first match wins per event. bot_escalation ignores mute (the alarm);
// the other three are suppressed when the player is muted.
export function evaluateNotifications(input: EvaluateInput): PendingNotification[] {
  if (input.type === 'join' && (input.isBot || input.muted)) {
    return fire(input, 'bot_escalation', COOLDOWN_BOT_ESCALATION);
  }
  if (input.muted) return [];
  if (input.status === 'blocked') {
    return fire(input, 'blocked_return', COOLDOWN_BLOCKED_RETURN);
  }
  if (input.type === 'join' && !input.hasPriorJoin) {
    return fire(input, 'first_sighting', null);
  }
  if (input.type === 'connection_rejected' && input.status === 'new') {
    return fire(input, 'new_player_rejection', COOLDOWN_NEW_PLAYER_REJECTION);
  }
  return [];
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

export interface FormatArgs {
  trigger: NotificationTrigger;
  serverName: string;
  playerName: string;
  playerId: string;
  siteUrl: string;
  reason: string | null;
}

const TRIGGER_TITLE: Record<NotificationTrigger, string> = {
  bot_escalation: '⚠️ Flagged player joined',
  blocked_return: '⛔ Blocked player returned',
  first_sighting: '👋 New player first seen',
  new_player_rejection: '🚪 New player rejected',
};

const TRIGGER_COLOR: Record<NotificationTrigger, number> = {
  bot_escalation: 0xe11d48,
  blocked_return: 0xdc2626,
  first_sighting: 0x16a34a,
  new_player_rejection: 0xd97706,
};

export function formatNotification(args: FormatArgs): DiscordPayload {
  const fields: DiscordEmbed['fields'] = [
    { name: 'Player', value: args.playerName, inline: true },
    { name: 'Server', value: args.serverName, inline: true },
  ];
  if (args.reason) fields.push({ name: 'Reason', value: args.reason });
  return {
    embeds: [
      {
        title: TRIGGER_TITLE[args.trigger],
        url: `${args.siteUrl}/dashboard/players/${args.playerId}`,
        color: TRIGGER_COLOR[args.trigger],
        fields,
      },
    ],
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `nx test shared`
Expected: PASS (all `evaluateNotifications` + `formatNotification` cases green).

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/notifications.ts libs/shared/src/notifications.test.ts
git commit -s -m "feat(shared): add pure notification decision logic"
```

---

### Task 3: `handlePresenceBatch` returns notable events

**Files:**
- Modify: `libs/shared/src/presence.ts:14-66` (add `NotableEvent`, extend `BatchResult`, collect notable events in the loop)
- Modify: `libs/shared/src/presence.test.ts` (assert the notable set)

**Interfaces:**
- Consumes: existing `IngestEvent`, `PresenceDao`.
- Produces: `BatchResult.notable: NotableEvent[]`; `NotableEvent` type.

- [ ] **Step 1: Write the failing test**

Add to `libs/shared/src/presence.test.ts` (it already imports `handlePresenceBatch`; add a `reject` helper and a describe block):

```ts
const reject = (key: string, ts: string): IngestEvent => ({
  type: 'connection_rejected',
  identityKind: 'minecraft',
  identityKey: key,
  playerName: 'Steve',
  ip: null,
  reason: 'not whitelisted',
  occurredAt: new Date(ts),
});
const lifecycle: IngestEvent = {
  type: 'server_start', identityKind: null, identityKey: null,
  playerName: null, ip: null, reason: null, occurredAt: new Date('2026-06-13T12:00:00Z'),
};

describe('handlePresenceBatch notable events', () => {
  it('returns newly-inserted join/rejection events with an identity', async () => {
    const { dao } = fakeDao();
    const res = await handlePresenceBatch(dao, 'srv1', [
      join('uuid-1', '2026-06-13T12:00:00Z'),
      reject('uuid-2', '2026-06-13T12:00:05Z'),
      lifecycle,
    ], now);
    expect(res.notable.map((n) => `${n.type}:${n.identityKey}`)).toEqual([
      'join:uuid-1',
      'connection_rejected:uuid-2',
    ]);
    expect(res.notable[0]).toMatchObject({ serverId: 'srv1', occurredAt: 1781352000, playerName: 'Steve' });
  });
  it('excludes deduped events from notable', async () => {
    const seen = new Set<string>();
    const { dao } = fakeDao(seen);
    await handlePresenceBatch(dao, 'srv1', [join('uuid-1', '2026-06-13T12:00:00Z')], now);
    const res = await handlePresenceBatch(dao, 'srv1', [join('uuid-1', '2026-06-13T12:00:00Z')], now);
    expect(res.notable).toEqual([]);
  });
  it('excludes leave events from notable', async () => {
    const { dao } = fakeDao();
    const leave: IngestEvent = { ...join('uuid-1', '2026-06-13T12:00:00Z'), type: 'leave' };
    const res = await handlePresenceBatch(dao, 'srv1', [leave], now);
    expect(res.notable).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `nx test shared`
Expected: FAIL — `res.notable` is `undefined`.

- [ ] **Step 3: Implement the notable collection**

In `libs/shared/src/presence.ts`, add the `NotableEvent` type after `PresenceEventRow`:

```ts
export interface NotableEvent {
  serverId: string;
  type: 'join' | 'connection_rejected';
  identityKind: PlayerIdentityKind;
  identityKey: string;
  playerName: string | null;
  reason: string | null;
  occurredAt: number; // epoch seconds
}
```

Extend `BatchResult`:

```ts
export interface BatchResult {
  accepted: number;
  deduped: number;
  notable: NotableEvent[];
}
```

Rewrite the loop in `handlePresenceBatch` to collect notable events (only newly-inserted join/rejection with an identity):

```ts
export async function handlePresenceBatch(
  dao: PresenceDao,
  serverId: string,
  events: IngestEvent[],
  now: Date,
): Promise<BatchResult> {
  let accepted = 0;
  let deduped = 0;
  const notable: NotableEvent[] = [];
  for (const e of events) {
    const dedupeKey = buildDedupeKey(serverId, e.type, e.identityKey, e.occurredAt);
    const inserted = await dao.insertEvent({ ...e, serverId, dedupeKey });
    if (!inserted) {
      deduped += 1;
      continue;
    }
    accepted += 1;
    if (e.identityKind && e.identityKey) {
      await dao.ensurePlayerIdentity(e.identityKind, e.identityKey, e.playerName, now);
      await dao.linkAccountIfMatch(e.identityKind, e.identityKey);
      if (e.type === 'join' || e.type === 'connection_rejected') {
        notable.push({
          serverId,
          type: e.type,
          identityKind: e.identityKind,
          identityKey: e.identityKey,
          playerName: e.playerName,
          reason: e.reason,
          occurredAt: Math.floor(e.occurredAt.getTime() / 1000),
        });
      }
    }
  }
  return { accepted, deduped, notable };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `nx test shared`
Expected: PASS (new block + existing presence tests).

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/presence.ts libs/shared/src/presence.test.ts
git commit -s -m "feat(shared): return notable events from presence batch"
```

---

### Task 4: Consumer orchestrator (`handleNotificationMessage`)

**Files:**
- Modify: `libs/shared/src/notifications.ts` (add `NotifyMessage`, `NotificationDao`, `DiscordPost`, `handleNotificationMessage`)
- Modify: `libs/shared/src/notifications.test.ts` (orchestrator tests with a fake DAO + fake post)

**Interfaces:**
- Consumes: `evaluateNotifications`, `formatNotification` (Task 2); `PlayerIdentityKind`, `PlayerStatus` from `./schema`.
- Produces: `handleNotificationMessage(dao, post, msg, siteUrl)`, `NotifyMessage`, `NotificationDao`, `DiscordPost` (see Canonical types).

- [ ] **Step 1: Write the failing tests**

Add to `libs/shared/src/notifications.test.ts`:

```ts
import { handleNotificationMessage, type NotificationDao, type NotifyMessage, type DiscordPost } from './notifications';

const msg: NotifyMessage = {
  serverId: 'srv1', type: 'join', identityKind: 'minecraft', identityKey: 'uuid-1',
  playerName: 'Steve', reason: null, occurredAt: 1_000_000,
};

function fakeNotifyDao(over: Partial<NotificationDao> = {}) {
  const recorded: string[] = [];
  const dao: NotificationDao = {
    async loadPlayer() { return { id: 'p1', displayName: 'Steve', status: 'allowed', isBot: false, muted: false }; },
    async loadServer() { return { name: 'Survival', discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc' }; },
    async lastSentByTrigger() { return {}; },
    async hasPriorJoin() { return false; },
    async recordNotification(r) { recorded.push(r.trigger); },
    ...over,
  };
  return { dao, recorded };
}

describe('handleNotificationMessage', () => {
  it('posts to Discord and records the log on a first sighting', async () => {
    const { dao, recorded } = fakeNotifyDao();
    const posts: string[] = [];
    const post: DiscordPost = async (url) => { posts.push(url); return { status: 204 }; };
    await handleNotificationMessage(dao, post, msg, 'https://voz.gg');
    expect(posts).toEqual(['https://discord.com/api/webhooks/1/abc']);
    expect(recorded).toEqual(['first_sighting']);
  });
  it('no-ops when the server has no webhook url', async () => {
    const { dao, recorded } = fakeNotifyDao({ async loadServer() { return { name: 'S', discordWebhookUrl: null }; } });
    const post: DiscordPost = async () => { throw new Error('should not post'); };
    await handleNotificationMessage(dao, post, msg, 'https://voz.gg');
    expect(recorded).toEqual([]);
  });
  it('no-ops when no trigger fires (suppressed by cooldown)', async () => {
    const { dao, recorded } = fakeNotifyDao({ async lastSentByTrigger() { return { first_sighting: 1 }; } });
    let posted = false;
    const post: DiscordPost = async () => { posted = true; return { status: 204 }; };
    await handleNotificationMessage(dao, post, msg, 'https://voz.gg');
    expect(posted).toBe(false);
    expect(recorded).toEqual([]);
  });
  it('drops on a 4xx without recording (bad webhook)', async () => {
    const { dao, recorded } = fakeNotifyDao();
    const post: DiscordPost = async () => ({ status: 404 });
    await handleNotificationMessage(dao, post, msg, 'https://voz.gg');
    expect(recorded).toEqual([]);
  });
  it('throws on a 5xx so the queue retries', async () => {
    const { dao } = fakeNotifyDao();
    const post: DiscordPost = async () => ({ status: 500 });
    await expect(handleNotificationMessage(dao, post, msg, 'https://voz.gg')).rejects.toThrow();
  });
  it('does not post when the player is unknown', async () => {
    const { dao } = fakeNotifyDao({ async loadPlayer() { return null; } });
    let posted = false;
    const post: DiscordPost = async () => { posted = true; return { status: 204 }; };
    await handleNotificationMessage(dao, post, msg, 'https://voz.gg');
    expect(posted).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `nx test shared`
Expected: FAIL — `handleNotificationMessage` is not exported.

- [ ] **Step 3: Implement the orchestrator**

Append to `libs/shared/src/notifications.ts`:

```ts
import type { PlayerIdentityKind } from './schema';

export interface NotifyMessage {
  serverId: string;
  type: 'join' | 'connection_rejected';
  identityKind: PlayerIdentityKind;
  identityKey: string;
  playerName: string | null;
  reason: string | null;
  occurredAt: number; // epoch seconds
}

export interface NotificationDao {
  loadPlayer(kind: PlayerIdentityKind, key: string): Promise<{
    id: string; displayName: string | null; status: PlayerStatus; isBot: boolean; muted: boolean;
  } | null>;
  loadServer(serverId: string): Promise<{ name: string; discordWebhookUrl: string | null } | null>;
  lastSentByTrigger(serverId: string, identityKey: string): Promise<Partial<Record<NotificationTrigger, number>>>;
  hasPriorJoin(serverId: string, identityKey: string, beforeEpochSeconds: number): Promise<boolean>;
  recordNotification(row: {
    serverId: string; identityKind: PlayerIdentityKind; identityKey: string;
    trigger: NotificationTrigger; occurredAt: number;
  }): Promise<void>;
}

export type DiscordPost = (url: string, payload: DiscordPayload) => Promise<{ status: number }>;

// Processes one queue message. Throws on a retryable failure (5xx / network) so the
// queue redelivers; returns normally (ack) on success, no-op, or a 4xx drop.
export async function handleNotificationMessage(
  dao: NotificationDao,
  post: DiscordPost,
  msg: NotifyMessage,
  siteUrl: string,
): Promise<void> {
  const player = await dao.loadPlayer(msg.identityKind, msg.identityKey);
  if (!player) return;

  const server = await dao.loadServer(msg.serverId);
  if (!server || !server.discordWebhookUrl) return;

  const lastSentAt = await dao.lastSentByTrigger(msg.serverId, msg.identityKey);
  const hasPriorJoin =
    msg.type === 'join' ? await dao.hasPriorJoin(msg.serverId, msg.identityKey, msg.occurredAt) : true;

  const pending = evaluateNotifications({
    type: msg.type,
    status: player.status,
    isBot: player.isBot,
    muted: player.muted,
    hasPriorJoin,
    occurredAt: msg.occurredAt,
    lastSentAt,
  });
  if (pending.length === 0) return;

  const { trigger } = pending[0];
  const payload = formatNotification({
    trigger,
    serverName: server.name,
    playerName: msg.playerName ?? player.displayName ?? msg.identityKey,
    playerId: player.id,
    siteUrl,
    reason: msg.reason,
  });

  const { status } = await post(server.discordWebhookUrl, payload);
  if (status >= 200 && status < 300) {
    await dao.recordNotification({
      serverId: msg.serverId,
      identityKind: msg.identityKind,
      identityKey: msg.identityKey,
      trigger,
      occurredAt: msg.occurredAt,
    });
    return;
  }
  if (status >= 500) {
    throw new Error(`Discord webhook returned ${status}`);
  }
  // 4xx: bad/removed webhook — drop without retry.
  console.warn(`Discord webhook ${msg.serverId} returned ${status}; dropping notification.`);
}
```

> Note: the `import type { PlayerIdentityKind }` line may be merged into the existing top-of-file import from `./schema` rather than duplicated — keep one import statement.

- [ ] **Step 4: Run to verify it passes**

Run: `nx test shared`
Expected: PASS (all orchestrator cases).

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/notifications.ts libs/shared/src/notifications.test.ts
git commit -s -m "feat(shared): add notification queue-message orchestrator"
```

---

### Task 5: Drizzle `NotificationDao` + barrel exports

**Files:**
- Create: `libs/shared/src/notification-dao.ts`
- Modify: `libs/shared/src/index.ts` (export `./notifications` + `./notification-dao`)

**Interfaces:**
- Consumes: `NotificationDao`, `NotificationTrigger`, `NotifyMessage` (Task 4); `Db` from `./client`; schema tables.
- Produces: `createNotificationDao(db: Db): NotificationDao`.

- [ ] **Step 1: Implement the DAO**

Create `libs/shared/src/notification-dao.ts`:

```ts
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from './client';
import { notificationLog, player, playerIdentity, servers, presenceEvents } from './schema';
import type { PlayerIdentityKind } from './schema';
import type { NotificationDao, NotificationTrigger } from './notifications';

export function createNotificationDao(db: Db): NotificationDao {
  return {
    async loadPlayer(kind: PlayerIdentityKind, key: string) {
      const row = await db
        .select({
          id: player.id,
          displayName: player.displayName,
          status: player.status,
          isBot: player.isBot,
          muted: player.muted,
        })
        .from(playerIdentity)
        .innerJoin(player, eq(player.id, playerIdentity.playerId))
        .where(and(eq(playerIdentity.kind, kind), eq(playerIdentity.identityKey, key)))
        .get();
      return row ?? null;
    },

    async loadServer(serverId: string) {
      const row = await db
        .select({ name: servers.name, discordWebhookUrl: servers.discordWebhookUrl })
        .from(servers)
        .where(eq(servers.id, serverId))
        .get();
      return row ?? null;
    },

    async lastSentByTrigger(serverId: string, identityKey: string) {
      const rows = await db
        .select({ trigger: notificationLog.trigger, occurredAt: notificationLog.occurredAt })
        .from(notificationLog)
        .where(and(eq(notificationLog.serverId, serverId), eq(notificationLog.identityKey, identityKey)))
        .orderBy(desc(notificationLog.occurredAt))
        .all();
      const out: Partial<Record<NotificationTrigger, number>> = {};
      for (const r of rows) {
        const epoch = Math.floor(r.occurredAt.getTime() / 1000);
        if (out[r.trigger] == null) out[r.trigger] = epoch; // rows are newest-first
      }
      return out;
    },

    async hasPriorJoin(serverId: string, identityKey: string, beforeEpochSeconds: number) {
      const row = await db
        .select({ id: presenceEvents.id })
        .from(presenceEvents)
        .where(
          and(
            eq(presenceEvents.serverId, serverId),
            eq(presenceEvents.identityKey, identityKey),
            eq(presenceEvents.type, 'join'),
            lt(presenceEvents.occurredAt, new Date(beforeEpochSeconds * 1000)),
          ),
        )
        .get();
      return row != null;
    },

    async recordNotification(row) {
      await db.insert(notificationLog).values({
        id: crypto.randomUUID(),
        serverId: row.serverId,
        identityKind: row.identityKind,
        identityKey: row.identityKey,
        trigger: row.trigger,
        occurredAt: new Date(row.occurredAt * 1000),
      });
    },
  };
}
```

- [ ] **Step 2: Add barrel exports**

In `libs/shared/src/index.ts`, after `export * from './player-mutations-dao';`:

```ts
export * from './notifications';
export * from './notification-dao';
```

- [ ] **Step 3: Verify it builds**

Run: `nx build shared`
Expected: PASS (tsc clean; Drizzle column types line up).

- [ ] **Step 4: Run shared tests (regression)**

Run: `nx test shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/notification-dao.ts libs/shared/src/index.ts
git commit -s -m "feat(shared): add drizzle notification dao and exports"
```

---

### Task 6: `events-ingest` producer + consumer wiring

**Files:**
- Modify: `services/events-ingest/src/index.ts` (Env, enqueue notable in `fetch`, add `queue` handler)
- Modify: `services/events-ingest/wrangler.toml` (queue producer + consumer + `SITE_URL` var)

**Interfaces:**
- Consumes: `handlePresenceBatch` (returns `notable`), `createNotificationDao`, `handleNotificationMessage`, `NotifyMessage`, `NotableEvent` from `@voz/shared`.

- [ ] **Step 1: Update `wrangler.toml`**

Add to `services/events-ingest/wrangler.toml`:

```toml
[vars]
SITE_URL = "https://voz.gg"

[[queues.producers]]
binding = "NOTIFY_QUEUE"
queue = "voz-gg-notifications"

[[queues.consumers]]
queue = "voz-gg-notifications"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 3
```

- [ ] **Step 2: Rewrite `index.ts` to enqueue and consume**

Replace `services/events-ingest/src/index.ts` with:

```ts
import {
  createDb,
  serverIdForAgentToken,
  createPresenceDao,
  createNotificationDao,
  handlePresenceBatch,
  handleNotificationMessage,
  parsePresenceBody,
  type NotifyMessage,
  type DiscordPayload,
} from '@voz/shared';

interface Env {
  DB: D1Database;
  NOTIFY_QUEUE: Queue<NotifyMessage>;
  SITE_URL: string;
}

const postDiscord = async (url: string, payload: DiscordPayload): Promise<{ status: number }> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      let database: string;
      try {
        await env.DB.prepare('SELECT 1').first();
        database = 'connected';
      } catch {
        database = 'error';
      }
      return Response.json({ service: 'events-ingest', status: 'ok', database });
    }

    if (url.pathname === '/presence' && request.method === 'POST') {
      const db = createDb(env.DB);
      const serverId = await serverIdForAgentToken(db, request.headers.get('authorization'));
      if (!serverId) return Response.json({ error: 'Unauthorized.' }, { status: 401 });

      const parsed = parsePresenceBody(await request.json().catch(() => null));
      if (!parsed.ok) return Response.json({ error: 'Invalid presence body.' }, { status: 400 });

      const result = await handlePresenceBatch(createPresenceDao(db), serverId, parsed.events, new Date());
      if (result.notable.length > 0) {
        await env.NOTIFY_QUEUE.sendBatch(result.notable.map((body) => ({ body })));
      }
      return Response.json({ accepted: result.accepted, deduped: result.deduped, rejected: parsed.rejected });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },

  async queue(batch: MessageBatch<NotifyMessage>, env: Env): Promise<void> {
    const dao = createNotificationDao(createDb(env.DB));
    for (const message of batch.messages) {
      try {
        await handleNotificationMessage(dao, postDiscord, message.body, env.SITE_URL);
        message.ack();
      } catch (err) {
        console.error('notification delivery failed; retrying', err);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
```

> `NotableEvent` is structurally the `NotifyMessage` body — `result.notable` items are valid `NotifyMessage`s, so `sendBatch` typechecks.

- [ ] **Step 3: Verify it builds**

Run: `nx build events-ingest`
Expected: PASS (tsc `--noEmit` clean; `Queue`/`MessageBatch` come from `@cloudflare/workers-types`).

> If `Queue`/`MessageBatch` are not resolved, confirm `@cloudflare/workers-types` is in `services/events-ingest/tsconfig.json` `types` (it already provides `D1Database`/`ExportedHandler`). No new dependency should be needed.

- [ ] **Step 4: Commit**

```bash
git add services/events-ingest/src/index.ts services/events-ingest/wrangler.toml
git commit -s -m "feat(events-ingest): enqueue and consume notifications"
```

---

### Task 7: Web — player `muted` toggle

**Files:**
- Modify: `libs/shared/src/player-mutations.ts` (`PlayerCore`, `PlayerFieldsUpdate`, `playerFieldsSchema`, `parsePlayerFieldsInput`)
- Modify: `libs/shared/src/player-mutations.test.ts` (assert `muted` parses)
- Modify: `libs/shared/src/player-mutations-dao.ts:9-23` (`getPlayer` selects `muted`)
- Modify: `apps/web/src/components/dashboard/PlayerFieldsEditor.tsx` (muted checkbox + PATCH body)

**Interfaces:**
- Consumes: existing player mutation path; `player.muted` column (Task 1).
- Produces: `muted` flows through `parsePlayerFieldsInput` → `updatePlayer`; `PlayerCore.muted`.

- [ ] **Step 1: Write the failing test**

Add to `libs/shared/src/player-mutations.test.ts` (it already exercises `parsePlayerFieldsInput`):

```ts
import { parsePlayerFieldsInput } from './player-mutations';

describe('parsePlayerFieldsInput muted', () => {
  it('accepts a muted boolean', () => {
    const r = parsePlayerFieldsInput({ muted: true });
    expect(r).toEqual({ ok: true, data: { muted: true } });
  });
  it('rejects a non-boolean muted', () => {
    const r = parsePlayerFieldsInput({ muted: 'yes' });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `nx test shared`
Expected: FAIL — `muted` is stripped, yielding `{ ok: false, error: 'No fields to update.' }`.

- [ ] **Step 3: Thread `muted` through the mutation module**

In `libs/shared/src/player-mutations.ts`:

`PlayerCore` (add `muted`):
```ts
export interface PlayerCore {
  id: string;
  displayName: string | null;
  notes: string | null;
  status: PlayerStatus;
  isBot: boolean;
  muted: boolean;
  userId: string | null;
}
```

`PlayerFieldsUpdate` (add `muted`):
```ts
export type PlayerFieldsUpdate = {
  displayName?: string | null;
  status?: PlayerStatus;
  isBot?: boolean;
  muted?: boolean;
  notes?: string | null;
};
```

`playerFieldsSchema` (add `muted`):
```ts
const playerFieldsSchema = z.object({
  displayName: z.string().max(120).nullable().optional(),
  status: z.enum(PLAYER_STATUSES).optional(),
  isBot: z.boolean().optional(),
  muted: z.boolean().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});
```

`parsePlayerFieldsInput` (copy `muted` like `isBot`):
```ts
  if ('isBot' in parsed.data) out.isBot = parsed.data.isBot;
  if ('muted' in parsed.data) out.muted = parsed.data.muted;
```

- [ ] **Step 4: Select `muted` in the DAO `getPlayer`**

In `libs/shared/src/player-mutations-dao.ts`, the `getPlayer` select — add `muted`:
```ts
        .select({
          id: player.id,
          displayName: player.displayName,
          notes: player.notes,
          status: player.status,
          isBot: player.isBot,
          muted: player.muted,
          userId: player.userId,
        })
```

> `updatePlayer` spreads `fields`, so `muted` persists automatically once it is in `PlayerFieldsUpdate`.

- [ ] **Step 5: Run to verify shared passes**

Run: `nx test shared`
Expected: PASS (muted cases + `computeMergeResult`/`PlayerCore` consumers still compile).

> If TypeScript flags a `PlayerCore` literal missing `muted` in existing tests, add `muted: false` to those fixtures.

- [ ] **Step 6: Add the muted Switch to `PlayerFieldsEditor.tsx`**

The `muted` control uses the D3 `switch.tsx` primitive (per the design). Add the import at the top of the file, alongside the existing UI imports:

```ts
import { Switch } from '../ui/switch';
```

Update `Props` and state.

`Props`:
```ts
type Props = {
  playerId: string;
  displayName: string | null;
  status: PlayerStatus;
  isBot: boolean;
  muted: boolean;
  notes: string | null;
};
```

Component signature + state:
```ts
export default function PlayerFieldsEditor({ playerId, displayName, status, isBot, muted, notes }: Props) {
  const [name, setName] = useState(displayName ?? '');
  const [statusValue, setStatusValue] = useState<PlayerStatus>(status);
  const [bot, setBot] = useState(isBot);
  const [mutedValue, setMutedValue] = useState(muted);
  const [notesValue, setNotesValue] = useState(notes ?? '');
  const [pending, setPending] = useState(false);
```

PATCH body (add `muted`):
```ts
        body: JSON.stringify({ displayName: name, status: statusValue, isBot: bot, muted: mutedValue, notes: notesValue }),
```

Add the Switch right after the `isBot` label block (lay it out like the `logParserEnabled` switch in `ServerFormDialog.tsx` — a labelled row with the `Switch`):
```tsx
      <div className="flex items-center justify-between gap-2">
        <div className="grid gap-1">
          <Label htmlFor="muted">Muted</Label>
          <p className="text-xs text-muted-foreground">Silence routine alerts (escalation still fires).</p>
        </div>
        <Switch
          id="muted"
          checked={mutedValue}
          onCheckedChange={(checked) => setMutedValue(checked)}
        />
      </div>
```

- [ ] **Step 7: Pass `muted` from the player detail page**

In `apps/web/src/pages/dashboard/players/[id].astro`, find where `PlayerFieldsEditor` is mounted and add `muted={...}` to its props (the player record already carries `muted` after Task 1). Search: `rg -n "PlayerFieldsEditor" apps/web/src/pages/dashboard/players/[id].astro`. Add `muted={player.muted}` (match the local variable name used for the other fields like `isBot`).

- [ ] **Step 8: Build web**

Run: `nx build web`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add libs/shared/src/player-mutations.ts libs/shared/src/player-mutations.test.ts libs/shared/src/player-mutations-dao.ts apps/web/src/components/dashboard/PlayerFieldsEditor.tsx "apps/web/src/pages/dashboard/players/[id].astro"
git commit -s -m "feat(web): add per-player muted toggle"
```

---

### Task 8: Web — per-server `discordWebhookUrl`

**Files:**
- Modify: `apps/web/src/lib/server-schema.ts` (add `discordWebhookUrl` field)
- Modify/Create: `apps/web/src/lib/server-schema.test.ts` (validation cases)
- Modify: `apps/web/src/components/dashboard/ServerFormDialog.tsx` (`ServerData` type + text input + submit body)
- Modify: `apps/web/src/pages/dashboard/servers.astro` (pass `discordWebhookUrl` into the dialog props)
- Modify: `apps/web/src/pages/api/servers/index.ts` (POST insert) and `apps/web/src/pages/api/servers/[id].ts` (PUT update)

**Interfaces:**
- Consumes: `parseServerInput`/`ServerInput`; `servers.discordWebhookUrl` column (Task 1).
- Produces: webhook URL persisted on create/edit and pre-populated on edit.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/lib/server-schema.test.ts` (create it if absent, importing `parseServerInput`). A valid base server object needs `name`, `gameType`, `host`, `port`:

```ts
import { describe, it, expect } from 'vitest';
import { parseServerInput } from './server-schema';

const valid = { name: 'S', gameType: 'minecraft-java', host: 'example.com', port: 25565 };

describe('parseServerInput discordWebhookUrl', () => {
  it('accepts a discord webhook url', () => {
    const r = parseServerInput({ ...valid, discordWebhookUrl: 'https://discord.com/api/webhooks/123/abcDEF-_' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.discordWebhookUrl).toBe('https://discord.com/api/webhooks/123/abcDEF-_');
  });
  it('coerces blank to null', () => {
    const r = parseServerInput({ ...valid, discordWebhookUrl: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.discordWebhookUrl).toBeNull();
  });
  it('rejects a non-discord url', () => {
    const r = parseServerInput({ ...valid, discordWebhookUrl: 'https://evil.example.com/hook' });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `nx test web`
Expected: FAIL — `discordWebhookUrl` is unknown (stripped → `undefined`, and the reject case passes through).

- [ ] **Step 3: Add the field to `server-schema.ts`**

In `serverSchema`, after `logParserEnabled`:

```ts
  discordWebhookUrl: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine(
      (v) => v === null || /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(v),
      'Must be a Discord webhook URL.',
    ),
```

- [ ] **Step 4: Run to verify it passes**

Run: `nx test web`
Expected: PASS (the three new cases).

- [ ] **Step 5: Persist in the POST route**

In `apps/web/src/pages/api/servers/index.ts`, the `db.insert(servers).values({...})` — add after `logParserEnabled`:
```ts
    logParserEnabled: parsed.data.logParserEnabled,
    discordWebhookUrl: parsed.data.discordWebhookUrl,
```

- [ ] **Step 6: Persist in the PUT route**

In `apps/web/src/pages/api/servers/[id].ts`, the `.set({...})` — add after `logParserEnabled`:
```ts
      logParserEnabled: parsed.data.logParserEnabled,
      discordWebhookUrl: parsed.data.discordWebhookUrl,
```

- [ ] **Step 7: Add the field to the server form**

In `apps/web/src/components/dashboard/ServerFormDialog.tsx`:

`ServerData` type — add:
```ts
  logParserEnabled: boolean | null;
  discordWebhookUrl: string | null;
```

`handleSubmit` body — add (read from FormData like `description`):
```ts
      logParserEnabled: agentHost.logParserEnabled,
      discordWebhookUrl: form.get('discordWebhookUrl'),
```

Add a text input near the log-path field (uncontrolled, pre-populated via `defaultValue`):
```tsx
            <div className="grid gap-2">
              <Label htmlFor="discordWebhookUrl" className="text-muted-foreground">Discord webhook URL</Label>
              <Input
                id="discordWebhookUrl"
                name="discordWebhookUrl"
                type="url"
                defaultValue={server?.discordWebhookUrl ?? ''}
                maxLength={200}
                placeholder="https://discord.com/api/webhooks/..."
              />
              <p className="text-xs text-muted-foreground">Presence alerts post here. Leave blank to disable.</p>
            </div>
```

- [ ] **Step 8: Pass `discordWebhookUrl` from `servers.astro`**

In `apps/web/src/pages/dashboard/servers.astro`, the `<ServerFormDialog ... server={{ ... }} />` props object — add `discordWebhookUrl: s.discordWebhookUrl` to the inline object.

- [ ] **Step 9: Build web**

Run: `nx build web`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/server-schema.ts apps/web/src/lib/server-schema.test.ts apps/web/src/components/dashboard/ServerFormDialog.tsx apps/web/src/pages/dashboard/servers.astro apps/web/src/pages/api/servers/
git commit -s -m "feat(web): add per-server discord webhook url"
```

---

### Task 9: Final gate + docs

**Files:**
- Modify: `AGENTS.md` (add a short #25c note under "Player presence")

- [ ] **Step 1: Full build/test/lint across affected projects**

Run: `nx run-many -t build,test,lint -p shared events-ingest web`
Expected: PASS — shared tests (incl. notifications), web tests, all builds, lint clean (pre-existing PR-A lint warnings in `api/players.ts`, if any, are unrelated).

- [ ] **Step 2: Confirm the migration applies cleanly from scratch (local)**

Run: `cd apps/web && npx wrangler d1 migrations list voz-gg --local`
Expected: `0014_*` shown as applied (from Task 1). If working on a fresh DB, `npx wrangler d1 migrations apply voz-gg --local` applies it without error.

- [ ] **Step 3: Document the feature in `AGENTS.md`**

Under the `### Player presence (#25a)` section, append a `### Presence notifications (#25c)` note:

```markdown
### Presence notifications (#25c)

`events-ingest` is both producer and consumer of the `voz-gg-notifications` queue.
`handlePresenceBatch` returns `notable` events (newly-inserted join/connection_rejected
with an identity); the `fetch` handler enqueues them and the `queue` handler runs the pure
`evaluateNotifications` (`libs/shared/src/notifications.ts`), POSTs a per-server
`discordWebhookUrl`, and writes a `notification_log` row for dedup/cooldown/audit. Four
triggers (bot/muted escalation, blocked-return, first-sighting, new-player-rejection) with
per-player `muted` silencing the routine three. One-time setup before deploy:
`wrangler queues create voz-gg-notifications`.
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -s -m "docs: document #25c presence notifications"
```

---

## Post-implementation (handled outside the tasks)

1. **Whole-branch review** (`superpowers:requesting-code-review`), then `superpowers:finishing-a-development-branch`.
2. **Re-sign all commits** (worktree signing was disabled): `git rebase <base> --exec 'git commit --amend --no-edit -S'`; verify each carries `Signed-off-by`.
3. **Open the PR** (merge-commit model). PR description MUST call out the **one-time ops step**: `wrangler queues create voz-gg-notifications` (queue must exist before the `events-ingest` deploy succeeds), and that migration `0014` runs `--remote` automatically on deploy.
4. **Carry-forward / deferred:** at-least-once delivery can rarely double-post within the idempotency window (benign given cooldowns); no DLQ configured (messages drop after `max_retries`); live Discord round-trip is UNVERIFIED until a real webhook is set on a server.

## Self-review notes (author checklist — completed)

- **Spec coverage:** triggers/precedence/cooldowns → Task 2; mute semantics → Tasks 1/2/7; per-server webhook → Tasks 1/8; queue producer/consumer same-Worker → Task 6; notable events → Task 3; data model/migration `0014` → Task 1; idempotency/4xx-drop/5xx-retry → Tasks 4/6; web UI → Tasks 7/8; testing → Tasks 2/3/4/7/8/9; ops queue-create → Tasks 6/9. All spec sections map to a task.
- **Type consistency:** `NotifyMessage`/`NotableEvent` field names and `occurredAt` (epoch seconds) are identical across Tasks 3/4/6; `NotificationDao` method signatures match between Task 4 (interface) and Task 5 (impl); `evaluateNotifications` input matches the orchestrator call in Task 4.
- **Placeholders:** none — every code step shows literal code; the only `rg`-to-locate steps (Task 7 step 7, Task 8 step 8) point at exact files whose surrounding code is shown in this plan.
