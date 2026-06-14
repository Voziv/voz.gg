# Player management & views (#25b) — PR-A (views / read) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read/views half of #25b — schema for player status/groups, read-time helpers for player detail and per-server scoping, and the player + per-server views — verifiable against synthetic D1 data with no Go producer.

**Architecture:** Additive D1 schema (status, isBot, group_tag, player_group_tag). Pure aggregation functions in `libs/shared` (TDD, fake inputs) assemble overview + detail; thin Astro pages and DB wrappers read through them. Visibility is tiered in the page templates (everyone sees the views; admin/owner see management surfaces); all mutation is deferred to PR-B.

**Tech Stack:** TypeScript, Drizzle ORM (Cloudflare D1), Astro SSR, vitest, NX.

**Spec:** `docs/superpowers/specs/2026-06-14-player-management-views-design.md`

**Scope note:** This is PR-A of two. PR-B (mutation endpoints, admin islands, merge, the Base UI combobox for add-or-create groups) gets its own plan after PR-A merges, mirroring the #25a PR-1/PR-2 split. **Deliberate refinement of the spec:** PR-A list filters use native server-rendered `<select>` query-param controls (no React island, no hydration risk) instead of a new Base UI primitive; the richer Base UI Combobox primitive is built in PR-B where the add-or-create group editor genuinely needs it. Flag this for the user at review.

---

## File structure

- `libs/shared/src/schema.ts` — add `PLAYER_STATUSES`, `player.status`, `player.isBot`, `groupTag`, `playerGroupTag` (modify).
- `libs/shared/src/sessions.ts` — carry `ip` through `DerivableEvent` → `Session` (modify).
- `libs/shared/src/sessions.test.ts` — IP-carry test (modify).
- `libs/shared/src/players.ts` — enrich `assemblePlayersOverview` (status, isBot, groups, minecraftName, optional `serverId` scope) (modify).
- `libs/shared/src/players.test.ts` — enrichment + scope tests (modify).
- `libs/shared/src/player-detail.ts` — new `assemblePlayerDetail` (pure) + `getPlayerDetail` (DB) (create).
- `libs/shared/src/player-detail.test.ts` — detail assembly tests (create).
- `libs/shared/src/index.ts` — export `./player-detail` (modify).
- `apps/web/drizzle/migrations/00NN_*.sql` — generated (create).
- `apps/web/src/pages/dashboard/players.astro` — relax gate, enrich list, filters (modify).
- `apps/web/src/pages/dashboard/players/[id].astro` — player detail view (create).
- `apps/web/src/pages/dashboard/servers/[id]/players.astro` — per-server players view (create).
- `apps/web/src/layouts/Dashboard.astro` — move Players nav link out of adminNav (modify).
- `AGENTS.md` — update the presence section for #25b views (modify).

---

## Task 1: Schema — status, isBot, group_tag, player_group_tag

**Files:**
- Modify: `libs/shared/src/schema.ts`
- Create: `apps/web/drizzle/migrations/00NN_*.sql` (generated)

- [ ] **Step 1: Add the status constant and player columns**

In `libs/shared/src/schema.ts`, add after the `PLAYER_IDENTITY_KINDS` block:

```ts
export const PLAYER_STATUSES = ['new', 'allowed', 'blocked'] as const;

export type PlayerStatus = (typeof PLAYER_STATUSES)[number];
```

Then add two columns to the existing `player` table (inside its column object, before `createdAt`):

```ts
  status: text('status').notNull().$type<PlayerStatus>().default('new'),
  isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
```

- [ ] **Step 2: Import `primaryKey` and add the group tables**

Update the top-of-file import to include `primaryKey`:

```ts
import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
```

Append the group tables to the end of `schema.ts`:

```ts
// Freeform, operator-defined tags. Named group_tag because `group` is a SQLite
// reserved word. Names are unique (case-insensitive match happens in app code).
export const groupTag = sqliteTable(
  'group_tag',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [uniqueIndex('group_tag_name_unq').on(table.name)],
);

// Many-to-many player ↔ group_tag.
export const playerGroupTag = sqliteTable(
  'player_group_tag',
  {
    playerId: text('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    groupTagId: text('group_tag_id')
      .notNull()
      .references(() => groupTag.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.playerId, table.groupTagId] })],
);
```

- [ ] **Step 3: Generate the migration**

Run: `cd apps/web && npx drizzle-kit generate`
Expected: a new `apps/web/drizzle/migrations/00NN_*.sql` adding `status`/`is_bot` columns to `player`, creating `group_tag` and `player_group_tag`, plus the `group_tag_name_unq` unique index. Confirm it is **additive only** (no DROP/ALTER of existing columns).

- [ ] **Step 4: Apply locally to verify it is well-formed**

Run: `cd apps/web && npx wrangler d1 migrations apply voz-gg --local`
Expected: applies cleanly with no error.

- [ ] **Step 5: Typecheck the shared lib**

Run: `nx build shared`
Expected: builds with no type error.

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/schema.ts apps/web/drizzle/migrations
git commit -s -m "feat(shared): add player status, isBot, and group tag tables"
```

---

## Task 2: Carry IP through session derivation

**Files:**
- Modify: `libs/shared/src/sessions.ts`
- Test: `libs/shared/src/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `libs/shared/src/sessions.test.ts` (add `deriveSessions` to the existing import from `./sessions` if not already imported):

```ts
import { describe, it, expect } from 'vitest';
import { deriveSessions } from './sessions';

const now = new Date('2026-06-13T12:00:00Z');
const d = (s: string) => new Date(s);

describe('deriveSessions IP carry', () => {
  it('carries the join event IP onto the closed session', () => {
    const [s] = deriveSessions(
      [
        { type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T10:00:00Z'), ip: '1.2.3.4' },
        { type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T10:30:00Z') },
      ],
      now,
    );
    expect(s.ip).toBe('1.2.3.4');
  });

  it('leaves ip null when the join carried none, including ongoing sessions', () => {
    const [s] = deriveSessions(
      [{ type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T11:00:00Z') }],
      now,
    );
    expect(s.open).toBe(true);
    expect(s.ip).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `nx test shared -- sessions`
Expected: FAIL — `Session` has no `ip` property / `s.ip` is undefined, not `'1.2.3.4'`.

- [ ] **Step 3: Implement the IP carry**

Edit `libs/shared/src/sessions.ts`. Add `ip` to the two interfaces:

```ts
export interface DerivableEvent {
  type: PresenceEventType;
  identityKey: string | null;
  occurredAt: Date;
  ip?: string | null;
}

export interface Session {
  identityKey: string;
  start: Date;
  end: Date;
  open: boolean; // true ⇒ still online (capped at `now`)
  ip: string | null; // IP captured at join, if the join line carried one
}
```

Change the `open` map to track the join IP, and thread it through every `close`/push. Replace the body from the `open` map declaration through the final return with:

```ts
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const open = new Map<string, { start: Date; ip: string | null }>(); // identityKey -> join
  const sessions: Session[] = [];

  const close = (identityKey: string, joined: { start: Date; ip: string | null }, end: Date) =>
    sessions.push({ identityKey, start: joined.start, end, open: false, ip: joined.ip });

  for (const e of ordered) {
    if (e.type === 'join' && e.identityKey) {
      // A second join with no leave: close the prior dangling one at this join.
      const prior = open.get(e.identityKey);
      if (prior) close(e.identityKey, prior, e.occurredAt);
      open.set(e.identityKey, { start: e.occurredAt, ip: e.ip ?? null });
    } else if (e.type === 'leave' && e.identityKey) {
      const joined = open.get(e.identityKey);
      if (joined) {
        close(e.identityKey, joined, e.occurredAt);
        open.delete(e.identityKey);
      }
    } else if (LIFECYCLE.has(e.type)) {
      for (const [identityKey, joined] of open) close(identityKey, joined, e.occurredAt);
      open.clear();
    }
  }

  // Anything still open while the server is up is ongoing up to now.
  for (const [identityKey, joined] of open) {
    sessions.push({ identityKey, start: joined.start, end: now, open: true, ip: joined.ip });
  }
  return sessions;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `nx test shared -- sessions`
Expected: PASS, including the pre-existing session tests.

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/sessions.ts libs/shared/src/sessions.test.ts
git commit -s -m "feat(shared): carry join IP onto derived sessions"
```

---

## Task 3: Enrich players overview (status, isBot, groups, minecraftName, server scope)

**Files:**
- Modify: `libs/shared/src/players.ts`
- Test: `libs/shared/src/players.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/shared/src/players.test.ts`:

```ts
import { PLAYER_STATUSES } from './schema';

describe('assemblePlayersOverview enrichment', () => {
  const base: OverviewInput = {
    players: [{ id: 'p1', displayName: 'Steve', userId: null, status: 'new', isBot: false }],
    identities: [{ playerId: 'p1', identityKey: 'u1', kind: 'minecraft', displayName: 'SteveMC' }],
    groups: [{ playerId: 'p1', name: 'WTK' }],
    events: [
      { serverId: 'srvA', type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T10:00:00Z') },
      { serverId: 'srvA', type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T10:30:00Z') },
      { serverId: 'srvB', type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T11:00:00Z') },
      { serverId: 'srvB', type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T11:15:00Z') },
    ],
  };

  it('surfaces status, isBot, groups, and the minecraft name pill', () => {
    const [row] = assemblePlayersOverview(base, now);
    expect(row.status).toBe('new');
    expect(row.isBot).toBe(false);
    expect(row.groups).toEqual(['WTK']);
    expect(row.minecraftName).toBe('SteveMC');
    expect(PLAYER_STATUSES).toContain(row.status);
  });

  it('scopes playtime, servers, and last seen to a single server when serverId is given', () => {
    const [row] = assemblePlayersOverview(base, now, { serverId: 'srvA' });
    expect(row.serversSeen).toEqual(['srvA']);
    expect(row.totalPlaytimeSeconds).toBe(30 * 60);
    expect(row.lastSeen).toEqual(d('2026-06-13T10:30:00Z'));
  });

  it('omits players never seen on the scoped server', () => {
    const rows = assemblePlayersOverview(base, now, { serverId: 'srvC' });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `nx test shared -- players`
Expected: FAIL — `OverviewInput` has no `groups`, identities have no `kind`, players have no `status`/`isBot`; `row.status`/`groups`/`minecraftName` undefined; scope option ignored.

- [ ] **Step 3: Update the input/output types and implementation**

Edit `libs/shared/src/players.ts`. Replace the `OverviewInput` and `PlayerOverviewRow` interfaces with:

```ts
import type { PlayerStatus } from './schema';

export interface OverviewInput {
  players: { id: string; displayName: string | null; userId: string | null; status: PlayerStatus; isBot: boolean }[];
  identities: { playerId: string; identityKey: string; kind: string; displayName: string | null }[];
  groups: { playerId: string; name: string }[];
  events: { serverId: string; type: DerivableEvent['type']; identityKey: string | null; occurredAt: Date }[];
}

export interface PlayerOverviewRow {
  playerId: string;
  displayName: string | null;
  userId: string | null;
  status: PlayerStatus;
  isBot: boolean;
  identityNames: string[];
  minecraftName: string | null;
  groups: string[];
  serversSeen: string[];
  lastSeen: Date | null;
  totalPlaytimeSeconds: number;
}

export interface OverviewOptions {
  serverId?: string; // scope every derived figure to one server
}
```

Replace the `assemblePlayersOverview` signature and body with:

```ts
export function assemblePlayersOverview(
  input: OverviewInput,
  now: Date,
  options: OverviewOptions = {},
): PlayerOverviewRow[] {
  const { serverId } = options;
  const events = serverId ? input.events.filter((e) => e.serverId === serverId) : input.events;

  const namesByPlayer = new Map<string, Set<string>>();
  const keysByPlayer = new Map<string, Set<string>>();
  const minecraftNameByPlayer = new Map<string, string | null>();
  const groupsByPlayer = new Map<string, string[]>();

  for (const p of input.players) {
    namesByPlayer.set(p.id, new Set(p.displayName ? [p.displayName] : []));
    keysByPlayer.set(p.id, new Set());
    minecraftNameByPlayer.set(p.id, null);
    groupsByPlayer.set(p.id, []);
  }
  for (const id of input.identities) {
    keysByPlayer.get(id.playerId)?.add(id.identityKey);
    if (id.displayName) {
      namesByPlayer.get(id.playerId)?.add(id.displayName);
      if (id.kind === 'minecraft' && !minecraftNameByPlayer.get(id.playerId)) {
        minecraftNameByPlayer.set(id.playerId, id.displayName);
      }
    }
  }
  for (const g of input.groups) groupsByPlayer.get(g.playerId)?.push(g.name);

  return input.players
    .map((p) => {
      const ownKeys = keysByPlayer.get(p.id) ?? new Set<string>();
      const byServer = new Map<string, DerivableEvent[]>();
      const serversSeen = new Set<string>();
      let lastSeen: Date | null = null;

      for (const e of events) {
        const belongsToPlayer = e.identityKey !== null && ownKeys.has(e.identityKey);
        const isLifecycle = e.identityKey === null;
        if (!belongsToPlayer && !isLifecycle) continue;
        if (belongsToPlayer) {
          serversSeen.add(e.serverId);
          if (!lastSeen || e.occurredAt > lastSeen) lastSeen = e.occurredAt;
        }
        const slice = byServer.get(e.serverId) ?? [];
        slice.push({ type: e.type, identityKey: e.identityKey, occurredAt: e.occurredAt });
        byServer.set(e.serverId, slice);
      }

      let totalSeconds = 0;
      for (const sid of serversSeen) {
        const sessions = deriveSessions(byServer.get(sid) ?? [], now).filter((s) => ownKeys.has(s.identityKey));
        totalSeconds += totalPlaytimeSeconds(sessions);
      }

      return {
        playerId: p.id,
        displayName: p.displayName,
        userId: p.userId,
        status: p.status,
        isBot: p.isBot,
        identityNames: [...(namesByPlayer.get(p.id) ?? [])],
        minecraftName: minecraftNameByPlayer.get(p.id) ?? null,
        groups: groupsByPlayer.get(p.id) ?? [],
        serversSeen: [...serversSeen],
        lastSeen,
        totalPlaytimeSeconds: totalSeconds,
      };
    })
    // When scoped to a server, drop players never seen there.
    .filter((row) => !serverId || row.serversSeen.length > 0);
}
```

- [ ] **Step 4: Update the existing overview tests for the new shape**

The three pre-existing tests in `players.test.ts` build `OverviewInput` without `status`/`isBot`/`kind`/`groups`. Update each `players` entry to include `status: 'new', isBot: false`, each `identities` entry to include `kind: 'minecraft'`, and add `groups: []` to each input object. (The `omits an event whose identity maps to no known player` test keeps `players: [], identities: [], groups: []`.)

- [ ] **Step 5: Update the DB query in `getPlayersOverview`**

Replace `getPlayersOverview` with:

```ts
export interface GetPlayersOverviewOptions {
  serverId?: string;
}

export async function getPlayersOverview(
  db: Db,
  now: Date,
  options: GetPlayersOverviewOptions = {},
): Promise<PlayerOverviewRow[]> {
  const players = await db
    .select({
      id: player.id,
      displayName: player.displayName,
      userId: player.userId,
      status: player.status,
      isBot: player.isBot,
    })
    .from(player)
    .all();
  const identities = await db
    .select({
      playerId: playerIdentity.playerId,
      identityKey: playerIdentity.identityKey,
      kind: playerIdentity.kind,
      displayName: playerIdentity.displayName,
    })
    .from(playerIdentity)
    .all();
  const groups = await db
    .select({ playerId: playerGroupTag.playerId, name: groupTag.name })
    .from(playerGroupTag)
    .innerJoin(groupTag, eq(groupTag.id, playerGroupTag.groupTagId))
    .all();
  const events = await db
    .select({
      serverId: presenceEvents.serverId,
      type: presenceEvents.type,
      identityKey: presenceEvents.identityKey,
      occurredAt: presenceEvents.occurredAt,
    })
    .from(presenceEvents)
    .all();

  return assemblePlayersOverview({ players, identities, groups, events }, now, options);
}
```

Update the imports at the top of `players.ts` to add `groupTag`, `playerGroupTag` and the `eq` operator:

```ts
import { eq } from 'drizzle-orm';
import { presenceEvents, player, playerIdentity, groupTag, playerGroupTag } from './schema';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `nx test shared -- players`
Expected: PASS (all enrichment + scope + updated legacy tests).

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/players.ts libs/shared/src/players.test.ts
git commit -s -m "feat(shared): enrich players overview with status, groups, server scope"
```

---

## Task 4: Player detail assembly + DB read

**Files:**
- Create: `libs/shared/src/player-detail.ts`
- Test: `libs/shared/src/player-detail.test.ts`
- Modify: `libs/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/shared/src/player-detail.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assemblePlayerDetail, type PlayerDetailInput } from './player-detail';

const now = new Date('2026-06-13T12:00:00Z');
const d = (s: string) => new Date(s);

const input: PlayerDetailInput = {
  player: { id: 'p1', displayName: 'Steve', userId: 'u-acct', notes: 'vip', status: 'allowed', isBot: false },
  identities: [{ identityKey: 'mc1', kind: 'minecraft', displayName: 'SteveMC' }],
  groups: ['WTK', '1LD'],
  account: { name: 'Steve R', displayName: 'Steve', image: null, minecraftName: 'SteveMC', steamPersona: null },
  serverNames: [
    { id: 'srvA', name: 'Vanilla' },
    { id: 'srvB', name: 'Stoneblock' },
  ],
  events: [
    { serverId: 'srvA', type: 'join', identityKey: 'mc1', playerName: 'SteveMC', ip: '1.2.3.4', reason: null, occurredAt: d('2026-06-13T10:00:00Z') },
    { serverId: 'srvA', type: 'leave', identityKey: 'mc1', playerName: 'SteveMC', ip: null, reason: null, occurredAt: d('2026-06-13T10:30:00Z') },
    { serverId: 'srvB', type: 'connection_rejected', identityKey: 'mc1', playerName: 'SteveMC', ip: '9.9.9.9', reason: 'whitelist', occurredAt: d('2026-06-13T11:00:00Z') },
  ],
};

describe('assemblePlayerDetail', () => {
  it('assembles identities, groups, status, notes, and the account passthrough', () => {
    const detail = assemblePlayerDetail(input, now);
    expect(detail.status).toBe('allowed');
    expect(detail.notes).toBe('vip');
    expect(detail.groups).toEqual(['WTK', '1LD']);
    expect(detail.identities).toEqual([{ identityKey: 'mc1', kind: 'minecraft', displayName: 'SteveMC' }]);
    expect(detail.account?.name).toBe('Steve R');
  });

  it('derives one session with its server name and join IP', () => {
    const detail = assemblePlayerDetail(input, now);
    expect(detail.sessions).toHaveLength(1);
    expect(detail.sessions[0]).toMatchObject({ serverId: 'srvA', serverName: 'Vanilla', ip: '1.2.3.4' });
    expect(detail.serversSeen).toEqual([
      { serverId: 'srvA', serverName: 'Vanilla', lastSeen: d('2026-06-13T10:30:00Z'), totalPlaytimeSeconds: 30 * 60 },
    ]);
  });

  it('collects distinct IPs seen and connection attempts (rejections)', () => {
    const detail = assemblePlayerDetail(input, now);
    expect(detail.ipsSeen.sort()).toEqual(['1.2.3.4', '9.9.9.9']);
    expect(detail.connectionAttempts).toHaveLength(1);
    expect(detail.connectionAttempts[0]).toMatchObject({ serverName: 'Stoneblock', reason: 'whitelist', ip: '9.9.9.9' });
  });

  it('scopes sessions, servers, IPs, and attempts to one server when serverId is given', () => {
    const detail = assemblePlayerDetail(input, now, { serverId: 'srvA' });
    expect(detail.sessions).toHaveLength(1);
    expect(detail.serversSeen.map((s) => s.serverId)).toEqual(['srvA']);
    expect(detail.connectionAttempts).toEqual([]);
    expect(detail.ipsSeen).toEqual(['1.2.3.4']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `nx test shared -- player-detail`
Expected: FAIL — `./player-detail` does not exist.

- [ ] **Step 3: Implement the pure assembly**

Create `libs/shared/src/player-detail.ts`:

```ts
import type { Db } from './client';
import { eq } from 'drizzle-orm';
import { presenceEvents, player, playerIdentity, groupTag, playerGroupTag, user } from './schema';
import type { PlayerStatus, PresenceEventType } from './schema';
import { deriveSessions, totalPlaytimeSeconds, type DerivableEvent } from './sessions';

export interface AccountSummary {
  name: string | null;
  displayName: string | null;
  image: string | null;
  minecraftName: string | null;
  steamPersona: string | null;
}

export interface DetailEvent {
  serverId: string;
  type: PresenceEventType;
  identityKey: string | null;
  playerName: string | null;
  ip: string | null;
  reason: string | null;
  occurredAt: Date;
}

export interface PlayerDetailInput {
  player: { id: string; displayName: string | null; userId: string | null; notes: string | null; status: PlayerStatus; isBot: boolean };
  identities: { identityKey: string; kind: string; displayName: string | null }[];
  groups: string[];
  account: AccountSummary | null;
  serverNames: { id: string; name: string }[];
  events: DetailEvent[];
}

export interface PlayerSessionRow {
  serverId: string;
  serverName: string;
  identityKey: string;
  start: Date;
  end: Date;
  open: boolean;
  ip: string | null;
}

export interface ServerSeenRow {
  serverId: string;
  serverName: string;
  lastSeen: Date;
  totalPlaytimeSeconds: number;
}

export interface ConnectionAttempt {
  serverId: string;
  serverName: string;
  occurredAt: Date;
  ip: string | null;
  reason: string | null;
  playerName: string | null;
}

export interface PlayerDetail {
  playerId: string;
  displayName: string | null;
  userId: string | null;
  notes: string | null;
  status: PlayerStatus;
  isBot: boolean;
  identities: { identityKey: string; kind: string; displayName: string | null }[];
  minecraftName: string | null;
  groups: string[];
  account: AccountSummary | null;
  serversSeen: ServerSeenRow[];
  sessions: PlayerSessionRow[];
  ipsSeen: string[];
  connectionAttempts: ConnectionAttempt[];
}

export interface PlayerDetailOptions {
  serverId?: string;
}

export function assemblePlayerDetail(
  input: PlayerDetailInput,
  now: Date,
  options: PlayerDetailOptions = {},
): PlayerDetail {
  const { serverId } = options;
  const ownKeys = new Set(input.identities.map((i) => i.identityKey));
  const serverNameById = new Map(input.serverNames.map((s) => [s.id, s.name]));
  const nameOf = (id: string) => serverNameById.get(id) ?? id;

  const events = serverId ? input.events.filter((e) => e.serverId === serverId) : input.events;

  // Group this player's + lifecycle events per server to derive sessions.
  const byServer = new Map<string, DerivableEvent[]>();
  const serversSeen = new Set<string>();
  const ipsSeen = new Set<string>();
  const connectionAttempts: ConnectionAttempt[] = [];

  for (const e of events) {
    const belongsToPlayer = e.identityKey !== null && ownKeys.has(e.identityKey);
    const isLifecycle = e.identityKey === null;
    if (!belongsToPlayer && !isLifecycle) continue;
    if (belongsToPlayer) {
      serversSeen.add(e.serverId);
      if (e.ip) ipsSeen.add(e.ip);
      if (e.type === 'connection_rejected') {
        connectionAttempts.push({
          serverId: e.serverId,
          serverName: nameOf(e.serverId),
          occurredAt: e.occurredAt,
          ip: e.ip,
          reason: e.reason,
          playerName: e.playerName,
        });
      }
    }
    const slice = byServer.get(e.serverId) ?? [];
    slice.push({ type: e.type, identityKey: e.identityKey, occurredAt: e.occurredAt, ip: e.ip });
    byServer.set(e.serverId, slice);
  }

  const sessions: PlayerSessionRow[] = [];
  const serverSeenRows: ServerSeenRow[] = [];
  for (const sid of serversSeen) {
    const own = deriveSessions(byServer.get(sid) ?? [], now).filter((s) => ownKeys.has(s.identityKey));
    let lastSeen: Date | null = null;
    for (const e of byServer.get(sid) ?? []) {
      if (e.identityKey && ownKeys.has(e.identityKey) && (!lastSeen || e.occurredAt > lastSeen)) lastSeen = e.occurredAt;
    }
    for (const s of own) {
      sessions.push({ serverId: sid, serverName: nameOf(sid), identityKey: s.identityKey, start: s.start, end: s.end, open: s.open, ip: s.ip });
    }
    serverSeenRows.push({
      serverId: sid,
      serverName: nameOf(sid),
      lastSeen: lastSeen ?? now,
      totalPlaytimeSeconds: totalPlaytimeSeconds(own),
    });
  }

  sessions.sort((a, b) => b.start.getTime() - a.start.getTime());
  connectionAttempts.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const minecraftName = input.identities.find((i) => i.kind === 'minecraft' && i.displayName)?.displayName ?? null;

  return {
    playerId: input.player.id,
    displayName: input.player.displayName,
    userId: input.player.userId,
    notes: input.player.notes,
    status: input.player.status,
    isBot: input.player.isBot,
    identities: input.identities,
    minecraftName,
    groups: input.groups,
    account: input.account,
    serversSeen: serverSeenRows,
    sessions,
    ipsSeen: [...ipsSeen],
    connectionAttempts,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `nx test shared -- player-detail`
Expected: PASS.

- [ ] **Step 5: Add the DB read function**

Append to `libs/shared/src/player-detail.ts`:

```ts
export async function getPlayerDetail(
  db: Db,
  playerId: string,
  now: Date,
  options: PlayerDetailOptions = {},
): Promise<PlayerDetail | null> {
  const row = await db
    .select({
      id: player.id,
      displayName: player.displayName,
      userId: player.userId,
      notes: player.notes,
      status: player.status,
      isBot: player.isBot,
    })
    .from(player)
    .where(eq(player.id, playerId))
    .get();
  if (!row) return null;

  const identities = await db
    .select({ identityKey: playerIdentity.identityKey, kind: playerIdentity.kind, displayName: playerIdentity.displayName })
    .from(playerIdentity)
    .where(eq(playerIdentity.playerId, playerId))
    .all();
  const groups = await db
    .select({ name: groupTag.name })
    .from(playerGroupTag)
    .innerJoin(groupTag, eq(groupTag.id, playerGroupTag.groupTagId))
    .where(eq(playerGroupTag.playerId, playerId))
    .all();
  const serverNames = await db.select({ id: servers.id, name: servers.name }).from(servers).all();

  // Events for this player's identities, plus all lifecycle events (null identity)
  // needed to cap dangling sessions. Fetch all and filter in the pure assembler.
  const events = await db
    .select({
      serverId: presenceEvents.serverId,
      type: presenceEvents.type,
      identityKey: presenceEvents.identityKey,
      playerName: presenceEvents.playerName,
      ip: presenceEvents.ip,
      reason: presenceEvents.reason,
      occurredAt: presenceEvents.occurredAt,
    })
    .from(presenceEvents)
    .all();

  let account: AccountSummary | null = null;
  if (row.userId) {
    const acct = await db
      .select({
        name: user.name,
        displayName: user.displayName,
        image: user.image,
        minecraftName: user.minecraftName,
        steamPersona: user.steamPersona,
      })
      .from(user)
      .where(eq(user.id, row.userId))
      .get();
    account = acct ?? null;
  }

  return assemblePlayerDetail(
    { player: row, identities, groups: groups.map((g) => g.name), account, serverNames, events },
    now,
    options,
  );
}
```

Add `servers` to the schema import on the file's first import line:

```ts
import { presenceEvents, player, playerIdentity, groupTag, playerGroupTag, user, servers } from './schema';
```

- [ ] **Step 6: Export the module**

Add to `libs/shared/src/index.ts`:

```ts
export * from './player-detail';
```

- [ ] **Step 7: Build and test**

Run: `nx build shared && nx test shared -- player-detail`
Expected: builds; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add libs/shared/src/player-detail.ts libs/shared/src/player-detail.test.ts libs/shared/src/index.ts
git commit -s -m "feat(shared): add player detail read-time assembly"
```

---

## Task 5: Relax players list gate, move nav link, enrich list + filters

**Files:**
- Modify: `apps/web/src/layouts/Dashboard.astro`
- Modify: `apps/web/src/pages/dashboard/players.astro`
- Modify: `apps/web/src/pages/api/players.ts`

- [ ] **Step 1: Move the Players nav link to the authenticated nav**

In `apps/web/src/layouts/Dashboard.astro`, add Players to `nav` and remove it from `adminNav`:

```ts
const nav = [
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/servers', label: 'Servers' },
  { href: '/dashboard/players', label: 'Players' },
];
```

```ts
const adminNav = [
  { href: '/dashboard/admin/users', label: 'Users' },
  { href: '/dashboard/admin/invites', label: 'Invite requests' },
  { href: '/dashboard/admin/audit', label: 'Audit log' },
];
```

- [ ] **Step 2: Relax the API gate to any authenticated user**

In `apps/web/src/pages/api/players.ts`, replace the admin check with an authentication check and forward the optional `server` query param:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb, getPlayersOverview } from '@voz/shared';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  if (!ctx.locals.user) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const serverId = new URL(ctx.request.url).searchParams.get('server') ?? undefined;
  const rows = await getPlayersOverview(createDb(env.DB), new Date(), { serverId });
  return Response.json({ players: rows });
};
```

- [ ] **Step 3: Rewrite the players page — relax gate, enrich rows, add filters**

Replace `apps/web/src/pages/dashboard/players.astro` with:

```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
import { createDb, getPlayersOverview, PLAYER_STATUSES } from '@voz/shared';
import { isAdmin } from '../../lib/admin';
import Dashboard from '../../layouts/Dashboard.astro';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Badge } from '../../components/ui/badge.tsx';

// Middleware already redirects unauthenticated dashboard requests to /sign-in;
// this guard is defensive and keeps the type non-null for isAdmin.
if (!Astro.locals.user) {
  return Astro.redirect('/sign-in');
}
const admin = isAdmin(Astro.locals.user);

const url = new URL(Astro.request.url);
const statusFilter = url.searchParams.get('status') ?? '';
const groupFilter = url.searchParams.get('group') ?? '';

let rows = await getPlayersOverview(createDb(env.DB), new Date());
const allGroups = [...new Set(rows.flatMap((r) => r.groups))].sort();
if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
if (groupFilter) rows = rows.filter((r) => r.groups.includes(groupFilter));

const STATUS_BADGE: Record<string, string> = {
  new: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  allowed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  blocked: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const formatLastSeen = (value: Date | null) => (value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—');
---
<Dashboard>
  <div class="mx-auto max-w-5xl">
    <div class="mb-8">
      <h1 class="text-3xl font-bold tracking-tight">Players</h1>
      <p class="mt-1 text-muted-foreground">Everyone seen across the community game servers.</p>
    </div>

    {admin && (
      <form method="get" class="mb-4 flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select name="status" class="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground">
            <option value="">All</option>
            {PLAYER_STATUSES.map((s) => (
              <option value={s} selected={s === statusFilter}>{s}</option>
            ))}
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          Group
          <select name="group" class="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground">
            <option value="">All</option>
            {allGroups.map((g) => (
              <option value={g} selected={g === groupFilter}>{g}</option>
            ))}
          </select>
        </label>
        <button type="submit" class="rounded-md border border-border bg-muted px-3 py-1.5 text-sm hover:bg-muted/70">Filter</button>
      </form>
    )}

    {rows.length === 0 ? (
      <Card className="border-border bg-card">
        <CardContent className="py-12 text-center text-muted-foreground">No players match.</CardContent>
      </Card>
    ) : (
      <div class="overflow-hidden rounded-lg border border-border bg-card">
        <table class="w-full text-sm">
          <thead class="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th class="px-4 py-3 font-medium">Player</th>
              <th class="px-4 py-3 font-medium">Groups</th>
              {admin && <th class="px-4 py-3 font-medium">Status</th>}
              <th class="px-4 py-3 font-medium">Servers</th>
              <th class="px-4 py-3 font-medium">Last seen</th>
              <th class="px-4 py-3 font-medium">Playtime</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr class="border-t border-border hover:bg-muted/40">
                <td class="px-4 py-3">
                  <a href={`/dashboard/players/${row.playerId}`} class="font-medium text-foreground hover:text-primary">
                    {row.displayName ?? row.minecraftName ?? row.identityNames[0] ?? 'Unknown'}
                  </a>
                  {row.minecraftName && <Badge className="ml-2 align-middle">{row.minecraftName}</Badge>}
                  {admin && row.isBot && <span class="ml-2 text-xs text-muted-foreground">bot</span>}
                </td>
                <td class="px-4 py-3 text-muted-foreground">{row.groups.join(', ') || '—'}</td>
                {admin && (
                  <td class="px-4 py-3">
                    <span class={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status] ?? ''}`}>{row.status}</span>
                  </td>
                )}
                <td class="px-4 py-3 text-muted-foreground">{row.serversSeen.length}</td>
                <td class="px-4 py-3 text-muted-foreground">{formatLastSeen(row.lastSeen)}</td>
                <td class="px-4 py-3 text-muted-foreground">{formatDuration(row.totalPlaytimeSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
</Dashboard>
```

- [ ] **Step 4: Build and lint the web app**

Run: `nx build web && nx lint web`
Expected: builds and lints clean. (If the `Badge` import path or export name differs, open `apps/web/src/components/ui/badge.tsx` and match its actual export.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/layouts/Dashboard.astro apps/web/src/pages/dashboard/players.astro apps/web/src/pages/api/players.ts
git commit -s -m "feat(web): open players list to all users, add pills, groups, filters"
```

---

## Task 6: Player detail page

**Files:**
- Create: `apps/web/src/pages/dashboard/players/[id].astro`

- [ ] **Step 1: Create the detail page**

Create `apps/web/src/pages/dashboard/players/[id].astro`:

```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
import { createDb, getPlayerDetail } from '@voz/shared';
import { isAdmin } from '../../../lib/admin';
import Dashboard from '../../../layouts/Dashboard.astro';
import { Card, CardContent } from '../../../components/ui/card.tsx';
import { Badge } from '../../../components/ui/badge.tsx';

// Middleware already redirects unauthenticated dashboard requests to /sign-in.
if (!Astro.locals.user) {
  return Astro.redirect('/sign-in');
}
const admin = isAdmin(Astro.locals.user);

const { id } = Astro.params;
const url = new URL(Astro.request.url);
const serverScope = url.searchParams.get('server') ?? undefined;

const detail = id ? await getPlayerDetail(createDb(env.DB), id, new Date(), { serverId: serverScope }) : null;
if (!detail) {
  return new Response('Player not found', { status: 404 });
}

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmt = (value: Date) => value.toISOString().slice(0, 16).replace('T', ' ');
const title = detail.displayName ?? detail.minecraftName ?? 'Unknown player';
---
<Dashboard>
  <div class="mx-auto max-w-4xl space-y-8">
    <div>
      <a href="/dashboard/players" class="text-sm text-muted-foreground hover:text-foreground">← All players</a>
      <h1 class="mt-2 flex items-center gap-2 text-3xl font-bold tracking-tight">
        {title}
        {detail.identities.map((i) => i.displayName && <Badge>{i.displayName}</Badge>)}
      </h1>
      <div class="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
        {detail.groups.map((g) => <span class="rounded bg-muted px-2 py-0.5">{g}</span>)}
        {admin && <span class="rounded bg-muted px-2 py-0.5">status: {detail.status}</span>}
        {admin && detail.isBot && <span class="rounded bg-muted px-2 py-0.5">bot</span>}
      </div>
    </div>

    {detail.account && (
      <Card className="border-border bg-card">
        <CardContent className="flex items-center gap-3 py-4">
          {detail.account.image && <img src={detail.account.image} alt="" class="h-10 w-10 rounded-full" />}
          <div class="text-sm">
            <div class="font-medium text-foreground">Linked account: {detail.account.displayName ?? detail.account.name}</div>
            <div class="text-muted-foreground">
              {detail.account.minecraftName && `MC: ${detail.account.minecraftName}`}
              {detail.account.steamPersona && ` · Steam: ${detail.account.steamPersona}`}
            </div>
          </div>
        </CardContent>
      </Card>
    )}

    <section>
      <h2 class="mb-3 text-lg font-semibold">Servers seen</h2>
      <div class="overflow-hidden rounded-lg border border-border bg-card">
        <table class="w-full text-sm">
          <thead class="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th class="px-4 py-3 font-medium">Server</th><th class="px-4 py-3 font-medium">Last seen</th><th class="px-4 py-3 font-medium">Playtime</th></tr>
          </thead>
          <tbody>
            {detail.serversSeen.map((s) => (
              <tr class="border-t border-border">
                <td class="px-4 py-3">
                  <a href={`/dashboard/players/${detail.playerId}?server=${s.serverId}`} class="text-foreground hover:text-primary">{s.serverName}</a>
                </td>
                <td class="px-4 py-3 text-muted-foreground">{fmt(s.lastSeen)}</td>
                <td class="px-4 py-3 text-muted-foreground">{formatDuration(s.totalPlaytimeSeconds)}</td>
              </tr>
            ))}
            {detail.serversSeen.length === 0 && <tr><td colspan="3" class="px-4 py-6 text-center text-muted-foreground">Not seen on any server.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2 class="mb-3 text-lg font-semibold">Sessions</h2>
      <div class="overflow-hidden rounded-lg border border-border bg-card">
        <table class="w-full text-sm">
          <thead class="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th class="px-4 py-3 font-medium">Server</th>
              <th class="px-4 py-3 font-medium">Start</th>
              <th class="px-4 py-3 font-medium">End</th>
              {admin && <th class="px-4 py-3 font-medium">IP</th>}
            </tr>
          </thead>
          <tbody>
            {detail.sessions.map((s) => (
              <tr class="border-t border-border">
                <td class="px-4 py-3">{s.serverName}</td>
                <td class="px-4 py-3 text-muted-foreground">{fmt(s.start)}</td>
                <td class="px-4 py-3 text-muted-foreground">{s.open ? 'online' : fmt(s.end)}</td>
                {admin && <td class="px-4 py-3 font-mono text-muted-foreground">{s.ip ?? '—'}</td>}
              </tr>
            ))}
            {detail.sessions.length === 0 && <tr><td colspan={admin ? 4 : 3} class="px-4 py-6 text-center text-muted-foreground">No sessions.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    {admin && (
      <section class="grid gap-6 md:grid-cols-2">
        <Card className="border-border bg-card">
          <CardContent class="py-4">
            <h3 class="mb-2 text-sm font-semibold">Notes</h3>
            <p class="whitespace-pre-wrap text-sm text-muted-foreground">{detail.notes || '—'}</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent class="py-4">
            <h3 class="mb-2 text-sm font-semibold">IPs seen</h3>
            <p class="font-mono text-sm text-muted-foreground">{detail.ipsSeen.join(', ') || '—'}</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card md:col-span-2">
          <CardContent class="py-4">
            <h3 class="mb-2 text-sm font-semibold">Connection attempts</h3>
            {detail.connectionAttempts.length === 0 ? (
              <p class="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul class="space-y-1 text-sm text-muted-foreground">
                {detail.connectionAttempts.map((a) => (
                  <li class="font-mono">{fmt(a.occurredAt)} · {a.serverName} · {a.ip ?? '—'} · {a.reason ?? 'rejected'}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    )}
  </div>
</Dashboard>
```

- [ ] **Step 2: Build and lint**

Run: `nx build web && nx lint web`
Expected: builds and lints clean. Resolve any `Badge`/`Card` prop mismatches against the actual primitive exports.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/dashboard/players/\[id\].astro
git commit -s -m "feat(web): add player detail view with sessions and admin panels"
```

---

## Task 7: Per-server players page

**Files:**
- Create: `apps/web/src/pages/dashboard/servers/[id]/players.astro`

- [ ] **Step 1: Create the per-server players page**

Create `apps/web/src/pages/dashboard/servers/[id]/players.astro`:

```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, getPlayersOverview, servers } from '@voz/shared';
import { isAdmin } from '../../../../lib/admin';
import Dashboard from '../../../../layouts/Dashboard.astro';
import { Card, CardContent } from '../../../../components/ui/card.tsx';
import { Badge } from '../../../../components/ui/badge.tsx';

// Middleware already redirects unauthenticated dashboard requests to /sign-in.
if (!Astro.locals.user) {
  return Astro.redirect('/sign-in');
}
const admin = isAdmin(Astro.locals.user);

const { id } = Astro.params;
const db = createDb(env.DB);
const server = id ? await db.select({ id: servers.id, name: servers.name }).from(servers).where(eq(servers.id, id)).get() : null;
if (!server) {
  return new Response('Server not found', { status: 404 });
}

const rows = await getPlayersOverview(db, new Date(), { serverId: server.id });

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const formatLastSeen = (value: Date | null) => (value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—');
---
<Dashboard>
  <div class="mx-auto max-w-5xl">
    <div class="mb-8">
      <a href="/dashboard/servers" class="text-sm text-muted-foreground hover:text-foreground">← Servers</a>
      <h1 class="mt-2 text-3xl font-bold tracking-tight">{server.name} — players</h1>
      <p class="mt-1 text-muted-foreground">Players seen on this server.</p>
    </div>

    {rows.length === 0 ? (
      <Card className="border-border bg-card">
        <CardContent className="py-12 text-center text-muted-foreground">No players seen on this server yet.</CardContent>
      </Card>
    ) : (
      <div class="overflow-hidden rounded-lg border border-border bg-card">
        <table class="w-full text-sm">
          <thead class="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th class="px-4 py-3 font-medium">Player</th>
              {admin && <th class="px-4 py-3 font-medium">Status</th>}
              <th class="px-4 py-3 font-medium">Last seen</th>
              <th class="px-4 py-3 font-medium">Playtime</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr class="border-t border-border hover:bg-muted/40">
                <td class="px-4 py-3">
                  <a href={`/dashboard/players/${row.playerId}?server=${server.id}`} class="font-medium text-foreground hover:text-primary">
                    {row.displayName ?? row.minecraftName ?? row.identityNames[0] ?? 'Unknown'}
                  </a>
                  {row.minecraftName && <Badge className="ml-2 align-middle">{row.minecraftName}</Badge>}
                </td>
                {admin && <td class="px-4 py-3 text-muted-foreground">{row.status}</td>}
                <td class="px-4 py-3 text-muted-foreground">{formatLastSeen(row.lastSeen)}</td>
                <td class="px-4 py-3 text-muted-foreground">{formatDuration(row.totalPlaytimeSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
</Dashboard>
```

- [ ] **Step 2: Build and lint**

Run: `nx build web && nx lint web`
Expected: builds and lints clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/dashboard/servers/\[id\]/players.astro
git commit -s -m "feat(web): add per-server players view"
```

---

## Task 8: Docs + full verification

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update the presence section in AGENTS.md**

In `AGENTS.md`, under `### Player presence (#25a)`, append a paragraph describing #25b:

```markdown
**Player management & views (#25b):** any logged-in user can browse
`/dashboard/players`, a player detail view (`/dashboard/players/<id>`, with
`?server=<id>` scoping), and a per-server roster
(`/dashboard/servers/<id>/players`). Players carry a `status`
(`new`/`allowed`/`blocked`, default `new`) and an informational `isBot` flag;
freeform groups live in `group_tag` + `player_group_tag`. Sessions, IPs, and
connection attempts are derived at read time (`libs/shared/src/player-detail.ts`).
Admin/owner see the management surfaces (status, notes, IPs, attempts) and, in
PR-B, edit them (rename, groups, identities, merge). IP columns stay empty until
the #25a PR-2 log producer captures join IPs.
```

- [ ] **Step 2: Run the full affected verification**

Run: `nx affected -t lint,test,build`
Expected: all green.

- [ ] **Step 3: Verify every commit carries the DCO trailer**

Run: `git log origin/main..HEAD --format='%h %s' && git log origin/main..HEAD --format=%B | grep -c Signed-off-by`
Expected: the sign-off count equals the number of commits on the branch.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -s -m "docs: document player management & views (#25b PR-A)"
```

---

## Self-review notes

- **Spec coverage:** status/isBot/groups schema (Task 1); IP-on-sessions (Task 2); enriched overview + per-server scope (Task 3); player detail incl. sessions/IPs/attempts/account passthrough + scope (Task 4); relaxed gate + nav move + pills/groups/status/filters (Task 5); detail page tiered visibility (Task 6); per-server view + drill-in (Task 7); docs (Task 8). Mutation endpoints, merge, admin islands, and the Base UI combobox are intentionally **PR-B**.
- **Deferred-to-PR-B (call out at review):** all write paths; the Base UI Select/Combobox primitive (PR-A uses native `<select>` filters instead).
- **Type consistency:** `OverviewInput`/`PlayerOverviewRow` (Task 3) and `PlayerDetailInput`/`PlayerDetail` (Task 4) are the contracts the pages in Tasks 5–7 consume; `Session.ip` (Task 2) feeds `PlayerSessionRow.ip` (Task 4).
- **Verify-at-build:** UI primitive prop names (`Badge`, `Card`) are matched against the actual exports during each page's build/lint step.
