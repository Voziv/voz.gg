# Presence & Identity Foundation — PR-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the backend + data half of #25a — the presence event store, the unified-player identity model, idempotent ingestion into the `events-ingest` Worker, read-time session/playtime derivation, and a bare admin players list — all verifiable with synthetic event batches (no Go agent yet).

**Architecture:** New D1 tables (`presence_events`, `player`, `player_identity`) in `libs/shared`. The `events-ingest` Worker exposes `POST /presence`: it authenticates the shared per-server agent token against `server_agent`, then runs a pure batch handler that idempotently inserts events and auto-creates/auto-links players. Sessions and playtime are derived at read time by a pure helper; `apps/web` renders them at `/dashboard/players` via `GET /api/players`. All non-trivial logic lives as pure functions in `libs/shared`, unit-tested with fake DAOs (mirroring the existing `agent-handlers` pattern); thin Worker/route wiring is left untested, consistent with the codebase (`agent-dao.ts` is untested).

**Tech Stack:** TypeScript, Drizzle ORM + Cloudflare D1, Cloudflare Workers, Astro SSR, Vitest, zod.

**Spec:** `docs/superpowers/specs/2026-06-13-presence-identity-foundation-design.md`

**Scope note:** PR-2 (the `voz-gg-agent logparse` Go daemon) is **not** in this plan — it depends on the provisioning sub-project's Go restructure landing first. This plan is PR-1 only.

**Conventions for every commit:** use `git commit -s` (DCO sign-off is required; verify with `git log -1 --format=%B | grep Signed-off-by`). Commit scopes: `shared`, `events-ingest`, `web`.

---

## File Structure

**Created:**
- `libs/shared/src/agent-token.ts` — token hashing + bearer parsing, shared by `apps/web` and `events-ingest`.
- `libs/shared/src/sessions.ts` — pure session/playtime derivation from ordered events.
- `libs/shared/src/presence.ts` — `PresenceDao` interface, `buildDedupeKey`, `handlePresenceBatch`, `parsePresenceBody` (pure ingest logic).
- `libs/shared/src/presence-dao.ts` — Drizzle implementation of `PresenceDao` + `serverIdForAgentToken`.
- `libs/shared/src/players.ts` — `assemblePlayersOverview` (pure) + `getPlayersOverview(db, now)`.
- `libs/shared/vitest.config.ts` — Vitest config for the shared lib.
- `libs/shared/src/agent-token.test.ts`, `sessions.test.ts`, `presence.test.ts`, `players.test.ts` — unit tests.
- `apps/web/src/pages/api/players.ts` — `GET /api/players` (admin-gated JSON).
- `apps/web/src/pages/dashboard/players.astro` — bare admin players list.

**Modified:**
- `libs/shared/src/schema.ts` — add the three tables + enums.
- `libs/shared/project.json` — add a `test` target.
- `libs/shared/package.json` — add `vitest` devDependency.
- `apps/web/src/lib/agent-config.ts` — import `sha256Hex` from `@voz/shared` instead of defining it.
- `apps/web/src/lib/agent-auth.ts` — re-export `hashToken`/`bearerToken` from `@voz/shared`.
- `services/events-ingest/src/index.ts` — add the `POST /presence` route.
- `services/events-ingest/package.json` — add `@voz/shared` + `zod` deps.
- `apps/web/src/layouts/Dashboard.astro` — add a Players link to the admin nav.
- `apps/web/drizzle/migrations/*` — generated migration.
- `AGENTS.md` — document the presence pipeline + event taxonomy.

---

## Task 1: Schema — `presence_events`, `player`, `player_identity` + migration

**Files:**
- Modify: `libs/shared/src/schema.ts`
- Generate: `apps/web/drizzle/migrations/0009_*.sql`

- [ ] **Step 1: Add the tables and enums to the schema**

Append to `libs/shared/src/schema.ts` (the file already imports `sqliteTable, text, integer` — add `uniqueIndex` to that import):

```ts
// at the top, extend the existing drizzle-orm/sqlite-core import:
// import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const PRESENCE_EVENT_TYPES = [
  'join',
  'leave',
  'connection_rejected',
  'server_start',
  'server_stop',
] as const;

export type PresenceEventType = (typeof PRESENCE_EVENT_TYPES)[number];

export const PLAYER_IDENTITY_KINDS = ['minecraft', 'steam', 'discord'] as const;

export type PlayerIdentityKind = (typeof PLAYER_IDENTITY_KINDS)[number];

// Raw, append-only event log. Sessions/playtime are derived at read time.
// `dedupeKey` is a deterministic NOT NULL key computed at ingest: a plain
// composite UNIQUE cannot be used because SQLite treats a NULL identity_key
// (lifecycle events) as distinct, so re-backfilled lifecycle lines would never
// dedupe.
export const presenceEvents = sqliteTable('presence_events', {
  id: text('id').primaryKey(),
  serverId: text('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  type: text('type').notNull().$type<PresenceEventType>(),
  identityKind: text('identity_kind').$type<PlayerIdentityKind>(),
  identityKey: text('identity_key'),
  playerName: text('player_name'),
  ip: text('ip'),
  reason: text('reason'),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
});

// A unified person across game identities. displayName/notes/userId are
// populated/edited in later sub-projects; auto-link sets userId here.
export const player = sqliteTable('player', {
  id: text('id').primaryKey(),
  displayName: text('display_name'),
  userId: text('user_id').references(() => user.id),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// One row per game identity; many per player.
export const playerIdentity = sqliteTable(
  'player_identity',
  {
    id: text('id').primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<PlayerIdentityKind>(),
    identityKey: text('identity_key').notNull(),
    displayName: text('display_name'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [uniqueIndex('player_identity_kind_key_unq').on(table.kind, table.identityKey)],
);
```

- [ ] **Step 2: Type-check the shared lib**

Run: `nx build shared`
Expected: PASS (tsc `--noEmit` clean).

- [ ] **Step 3: Generate the migration**

Run: `cd apps/web && npx drizzle-kit generate`
Expected: a new `apps/web/drizzle/migrations/0009_*.sql` is created plus updated `meta/` snapshot. Open the `.sql` and confirm it `CREATE TABLE`s `presence_events`, `player`, `player_identity`, a `UNIQUE` on `presence_events.dedupe_key`, and `CREATE UNIQUE INDEX player_identity_kind_key_unq`.

- [ ] **Step 4: Apply locally**

Run: `cd apps/web && npx wrangler d1 migrations apply voz-gg --local`
Expected: applies `0009` with no error.

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/schema.ts apps/web/drizzle/migrations
git commit -s -m "feat(shared): add presence_events, player, player_identity tables"
```

---

## Task 2: Shared token-auth helpers (`agent-token.ts`) + Vitest for `libs/shared`

**Files:**
- Create: `libs/shared/src/agent-token.ts`
- Create: `libs/shared/vitest.config.ts`
- Create: `libs/shared/src/agent-token.test.ts`
- Modify: `libs/shared/project.json`, `libs/shared/package.json`, `libs/shared/src/index.ts`
- Modify: `apps/web/src/lib/agent-config.ts`, `apps/web/src/lib/agent-auth.ts`

- [ ] **Step 1: Add a Vitest config + test target + dep to the shared lib**

Create `libs/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

In `libs/shared/project.json`, add a `test` target alongside `build`:

```json
    "test": {
      "command": "vitest run --passWithNoTests",
      "options": { "cwd": "libs/shared" }
    }
```

In `libs/shared/package.json`, add to `devDependencies`:

```json
    "vitest": "^4.1.7"
```

Run: `pnpm install`
Expected: lockfile resolves, vitest available to `shared`.

- [ ] **Step 2: Write the failing test**

Create `libs/shared/src/agent-token.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sha256Hex, hashToken, bearerToken } from './agent-token';

describe('sha256Hex', () => {
  it('hashes the empty string to the known SHA-256 vector', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('hashToken', () => {
  it('is sha256Hex of the token', async () => {
    expect(await hashToken('abc')).toBe(await sha256Hex('abc'));
  });
});

describe('bearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(bearerToken('Bearer xyz')).toBe('xyz');
  });
  it('is case-insensitive on the scheme and trims', () => {
    expect(bearerToken('  bearer   tok ')).toBe('tok');
  });
  it('returns null for a missing or malformed header', () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `nx test shared`
Expected: FAIL — `Cannot find module './agent-token'`.

- [ ] **Step 4: Implement `agent-token.ts`**

Create `libs/shared/src/agent-token.ts`:

```ts
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

// Pulls the raw token out of an `Authorization: Bearer <token>` header value.
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
```

Add to `libs/shared/src/index.ts`:

```ts
export * from './agent-token';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `nx test shared`
Expected: PASS.

- [ ] **Step 6: Point `apps/web` at the shared helpers (DRY)**

In `apps/web/src/lib/agent-config.ts`, delete the local `sha256Hex` definition and import it:

```ts
import { sha256Hex } from '@voz/shared';
```

(Keep `canonicalJson`, `buildAgentConfig`, `configHash` as-is; `configHash` still calls the now-imported `sha256Hex`. Remove the old `export async function sha256Hex` block.)

In `apps/web/src/lib/agent-auth.ts`, replace the local `hashToken`/`bearerToken` and the `sha256Hex` import with re-exports from shared, keeping `generateToken`, `TokenResolver`, and `serverIdForToken`:

```ts
import { hashToken, bearerToken } from '@voz/shared';

export { hashToken, bearerToken };

export function generateToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}

export interface TokenResolver {
  findServerIdByAgentTokenHash(hash: string): Promise<string | null>;
}

export async function serverIdForToken(dao: TokenResolver, token: string): Promise<string | null> {
  return dao.findServerIdByAgentTokenHash(await hashToken(token));
}
```

- [ ] **Step 7: Verify the web suite still passes**

Run: `nx test web` then `nx build web`
Expected: PASS (the existing `agent-auth.test.ts` / `agent-handlers.test.ts` cover these call sites).

- [ ] **Step 8: Commit**

```bash
git add libs/shared apps/web/src/lib/agent-config.ts apps/web/src/lib/agent-auth.ts
git commit -s -m "refactor(shared): extract agent token helpers for reuse by events-ingest"
```

---

## Task 3: Session / playtime derivation (`sessions.ts`)

**Files:**
- Create: `libs/shared/src/sessions.ts`
- Create: `libs/shared/src/sessions.test.ts`
- Modify: `libs/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/shared/src/sessions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveSessions, type DerivableEvent } from './sessions';

const at = (s: string) => new Date(s);

function ev(partial: Partial<DerivableEvent> & Pick<DerivableEvent, 'type' | 'occurredAt'>): DerivableEvent {
  return { identityKey: null, ...partial };
}

describe('deriveSessions', () => {
  it('pairs a join with the following leave for the same identity', () => {
    const sessions = deriveSessions(
      [
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') }),
        ev({ type: 'leave', identityKey: 'u1', occurredAt: at('2026-06-13T10:30:00Z') }),
      ],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions).toEqual([
      { identityKey: 'u1', start: at('2026-06-13T10:00:00Z'), end: at('2026-06-13T10:30:00Z'), open: false },
    ]);
  });

  it('caps a dangling join (no leave) at the next server_stop', () => {
    const sessions = deriveSessions(
      [
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') }),
        ev({ type: 'server_stop', occurredAt: at('2026-06-13T10:45:00Z') }),
      ],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions).toEqual([
      { identityKey: 'u1', start: at('2026-06-13T10:00:00Z'), end: at('2026-06-13T10:45:00Z'), open: false },
    ]);
  });

  it('caps a dangling join at the next server_start (crash with no clean stop)', () => {
    const sessions = deriveSessions(
      [
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') }),
        ev({ type: 'server_start', occurredAt: at('2026-06-13T11:00:00Z') }),
      ],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions[0].end).toEqual(at('2026-06-13T11:00:00Z'));
    expect(sessions[0].open).toBe(false);
  });

  it('treats a still-open join (server up) as ongoing up to now', () => {
    const sessions = deriveSessions(
      [ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') })],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions).toEqual([
      { identityKey: 'u1', start: at('2026-06-13T10:00:00Z'), end: at('2026-06-13T12:00:00Z'), open: true },
    ]);
  });

  it('keeps two different identities independent', () => {
    const sessions = deriveSessions(
      [
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') }),
        ev({ type: 'join', identityKey: 'u2', occurredAt: at('2026-06-13T10:05:00Z') }),
        ev({ type: 'leave', identityKey: 'u1', occurredAt: at('2026-06-13T10:20:00Z') }),
        ev({ type: 'leave', identityKey: 'u2', occurredAt: at('2026-06-13T10:25:00Z') }),
      ],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.identityKey === 'u1')?.end).toEqual(at('2026-06-13T10:20:00Z'));
    expect(sessions.find((s) => s.identityKey === 'u2')?.end).toEqual(at('2026-06-13T10:25:00Z'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `nx test shared`
Expected: FAIL — `Cannot find module './sessions'`.

- [ ] **Step 3: Implement `sessions.ts`**

Create `libs/shared/src/sessions.ts`:

```ts
import type { PresenceEventType } from './schema';

export interface DerivableEvent {
  type: PresenceEventType;
  identityKey: string | null;
  occurredAt: Date;
}

export interface Session {
  identityKey: string;
  start: Date;
  end: Date;
  open: boolean; // true ⇒ still online (capped at `now`)
}

const LIFECYCLE: ReadonlySet<PresenceEventType> = new Set(['server_start', 'server_stop']);

// Derive sessions for a SINGLE server's time-ordered events. A join is closed by
// the next leave for the same identity; failing that, by the next lifecycle event
// (crash cap); failing that, it is an ongoing session ending at `now`.
export function deriveSessions(events: DerivableEvent[], now: Date): Session[] {
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const open = new Map<string, Date>(); // identityKey -> join time
  const sessions: Session[] = [];

  const close = (identityKey: string, start: Date, end: Date) =>
    sessions.push({ identityKey, start, end, open: false });

  for (const e of ordered) {
    if (e.type === 'join' && e.identityKey) {
      // A second join with no leave: close the prior dangling one at this join.
      const prior = open.get(e.identityKey);
      if (prior) close(e.identityKey, prior, e.occurredAt);
      open.set(e.identityKey, e.occurredAt);
    } else if (e.type === 'leave' && e.identityKey) {
      const start = open.get(e.identityKey);
      if (start) {
        close(e.identityKey, start, e.occurredAt);
        open.delete(e.identityKey);
      }
    } else if (LIFECYCLE.has(e.type)) {
      for (const [identityKey, start] of open) close(identityKey, start, e.occurredAt);
      open.clear();
    }
  }

  // Anything still open while the server is up is ongoing up to now.
  for (const [identityKey, start] of open) {
    sessions.push({ identityKey, start, end: now, open: true });
  }
  return sessions;
}

export function totalPlaytimeSeconds(sessions: Session[]): number {
  return sessions.reduce((sum, s) => sum + Math.max(0, (s.end.getTime() - s.start.getTime()) / 1000), 0);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `nx test shared`
Expected: PASS.

- [ ] **Step 5: Export + commit**

Add to `libs/shared/src/index.ts`: `export * from './sessions';`

```bash
git add libs/shared/src/sessions.ts libs/shared/src/sessions.test.ts libs/shared/src/index.ts
git commit -s -m "feat(shared): derive sessions and playtime from presence events"
```

---

## Task 4: Pure ingest logic (`presence.ts`)

**Files:**
- Create: `libs/shared/src/presence.ts`
- Create: `libs/shared/src/presence.test.ts`
- Modify: `libs/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/shared/src/presence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDedupeKey, parsePresenceBody, handlePresenceBatch, type PresenceDao, type IngestEvent } from './presence';

const now = new Date('2026-06-13T12:00:00Z');

function fakeDao(seen = new Set<string>()) {
  const calls = { inserted: [] as string[], ensured: [] as string[], linked: [] as string[] };
  const dao: PresenceDao = {
    async insertEvent(row) {
      if (seen.has(row.dedupeKey)) return false;
      seen.add(row.dedupeKey);
      calls.inserted.push(row.dedupeKey);
      return true;
    },
    async ensurePlayerIdentity(kind, key, name) {
      calls.ensured.push(`${kind}:${key}:${name ?? ''}`);
    },
    async linkAccountIfMatch(kind, key) {
      calls.linked.push(`${kind}:${key}`);
    },
  };
  return { dao, calls };
}

const join = (key: string, ts: string): IngestEvent => ({
  type: 'join',
  identityKind: 'minecraft',
  identityKey: key,
  playerName: 'Steve',
  ip: null,
  reason: null,
  occurredAt: new Date(ts),
});

describe('buildDedupeKey', () => {
  it('coalesces a null identity to empty and uses epoch seconds', () => {
    expect(buildDedupeKey('srv1', 'server_stop', null, new Date('2026-06-13T10:00:00Z'))).toBe(
      'srv1|server_stop||1781776800',
    );
  });
});

describe('handlePresenceBatch', () => {
  it('inserts new events, ensures + links minecraft identities, and counts accepted', async () => {
    const { dao, calls } = fakeDao();
    const res = await handlePresenceBatch(dao, 'srv1', [join('u1', '2026-06-13T10:00:00Z')], now);
    expect(res).toEqual({ accepted: 1, deduped: 0 });
    expect(calls.ensured).toEqual(['minecraft:u1:Steve']);
    expect(calls.linked).toEqual(['minecraft:u1']);
  });

  it('dedupes a replayed batch — second pass inserts nothing', async () => {
    const seen = new Set<string>();
    const batch = [join('u1', '2026-06-13T10:00:00Z')];
    expect(await handlePresenceBatch(fakeDao(seen).dao, 'srv1', batch, now)).toEqual({ accepted: 1, deduped: 0 });
    expect(await handlePresenceBatch(fakeDao(seen).dao, 'srv1', batch, now)).toEqual({ accepted: 0, deduped: 1 });
  });

  it('skips identity work for lifecycle events', async () => {
    const { dao, calls } = fakeDao();
    const res = await handlePresenceBatch(
      dao,
      'srv1',
      [{ type: 'server_stop', identityKind: null, identityKey: null, playerName: null, ip: null, reason: null, occurredAt: new Date('2026-06-13T10:00:00Z') }],
      now,
    );
    expect(res.accepted).toBe(1);
    expect(calls.ensured).toEqual([]);
    expect(calls.linked).toEqual([]);
  });
});

describe('parsePresenceBody', () => {
  it('accepts a well-formed batch and coerces occurredAt (epoch seconds) to Date', () => {
    const parsed = parsePresenceBody({
      events: [{ type: 'join', identityKind: 'minecraft', identityKey: 'u1', playerName: 'Steve', occurredAt: 1781776800 }],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.events[0].occurredAt).toEqual(new Date('2026-06-13T10:00:00Z'));
      expect(parsed.events[0].type).toBe('join');
    }
  });

  it('rejects an unknown event type', () => {
    expect(parsePresenceBody({ events: [{ type: 'nope', occurredAt: 1 }] }).ok).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(parsePresenceBody(null).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `nx test shared`
Expected: FAIL — `Cannot find module './presence'`.

- [ ] **Step 3: Implement `presence.ts`**

Create `libs/shared/src/presence.ts`:

```ts
import { z } from 'zod';
import { PRESENCE_EVENT_TYPES, PLAYER_IDENTITY_KINDS, type PresenceEventType, type PlayerIdentityKind } from './schema';

export interface IngestEvent {
  type: PresenceEventType;
  identityKind: PlayerIdentityKind | null;
  identityKey: string | null;
  playerName: string | null;
  ip: string | null;
  reason: string | null;
  occurredAt: Date;
}

export interface PresenceEventRow extends IngestEvent {
  serverId: string;
  dedupeKey: string;
}

export interface PresenceDao {
  // Returns true if inserted, false if the dedupeKey already existed.
  insertEvent(row: PresenceEventRow): Promise<boolean>;
  // Create player + identity if absent; otherwise refresh the identity's name.
  ensurePlayerIdentity(kind: PlayerIdentityKind, key: string, name: string | null, now: Date): Promise<void>;
  // If a user account carries this identity and its player is unlinked, link it.
  linkAccountIfMatch(kind: PlayerIdentityKind, key: string): Promise<void>;
}

export interface BatchResult {
  accepted: number;
  deduped: number;
}

export function buildDedupeKey(
  serverId: string,
  type: PresenceEventType,
  identityKey: string | null,
  occurredAt: Date,
): string {
  const epochSeconds = Math.floor(occurredAt.getTime() / 1000);
  return `${serverId}|${type}|${identityKey ?? ''}|${epochSeconds}`;
}

export async function handlePresenceBatch(
  dao: PresenceDao,
  serverId: string,
  events: IngestEvent[],
  now: Date,
): Promise<BatchResult> {
  let accepted = 0;
  let deduped = 0;
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
    }
  }
  return { accepted, deduped };
}

const eventSchema = z.object({
  type: z.enum(PRESENCE_EVENT_TYPES),
  identityKind: z.enum(PLAYER_IDENTITY_KINDS).nullish(),
  identityKey: z.string().min(1).max(64).nullish(),
  playerName: z.string().max(64).nullish(),
  ip: z.string().max(64).nullish(),
  reason: z.string().max(200).nullish(),
  occurredAt: z.number().int().nonnegative(), // epoch seconds
});

const bodySchema = z.object({ events: z.array(eventSchema).max(1000) });

export type ParsedBody = { ok: true; events: IngestEvent[] } | { ok: false };

export function parsePresenceBody(body: unknown): ParsedBody {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return {
    ok: true,
    events: parsed.data.events.map((e) => ({
      type: e.type,
      identityKind: e.identityKind ?? null,
      identityKey: e.identityKey ?? null,
      playerName: e.playerName ?? null,
      ip: e.ip ?? null,
      reason: e.reason ?? null,
      occurredAt: new Date(e.occurredAt * 1000),
    })),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `nx test shared`
Expected: PASS.

- [ ] **Step 5: Export + commit**

Add to `libs/shared/src/index.ts`: `export * from './presence';`

```bash
git add libs/shared/src/presence.ts libs/shared/src/presence.test.ts libs/shared/src/index.ts
git commit -s -m "feat(shared): add idempotent presence batch ingest logic"
```

---

## Task 5: Drizzle `PresenceDao` + token resolver (`presence-dao.ts`)

**Files:**
- Create: `libs/shared/src/presence-dao.ts`
- Modify: `libs/shared/src/index.ts`

> No unit test: this is the thin Drizzle/D1 adapter, consistent with the untested `apps/web/src/lib/agent-dao.ts`. Behavior is exercised end-to-end via the synthetic verification in Task 7.

- [ ] **Step 1: Implement `presence-dao.ts`**

Create `libs/shared/src/presence-dao.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './client';
import { presenceEvents, player, playerIdentity, serverAgent, user } from './schema';
import type { PresenceDao, PresenceEventRow } from './presence';
import { bearerToken, hashToken } from './agent-token';
import type { PlayerIdentityKind } from './schema';

export function createPresenceDao(db: Db): PresenceDao {
  return {
    async insertEvent(row: PresenceEventRow) {
      const inserted = await db
        .insert(presenceEvents)
        .values({
          id: crypto.randomUUID(),
          serverId: row.serverId,
          type: row.type,
          identityKind: row.identityKind,
          identityKey: row.identityKey,
          playerName: row.playerName,
          ip: row.ip,
          reason: row.reason,
          occurredAt: row.occurredAt,
          dedupeKey: row.dedupeKey,
        })
        .onConflictDoNothing({ target: presenceEvents.dedupeKey })
        .returning({ id: presenceEvents.id });
      return inserted.length > 0;
    },

    async ensurePlayerIdentity(kind: PlayerIdentityKind, key: string, name: string | null, now: Date) {
      const existing = await db
        .select({ id: playerIdentity.id })
        .from(playerIdentity)
        .where(and(eq(playerIdentity.kind, kind), eq(playerIdentity.identityKey, key)))
        .get();

      if (existing) {
        if (name) {
          await db
            .update(playerIdentity)
            .set({ displayName: name, updatedAt: now })
            .where(eq(playerIdentity.id, existing.id));
        }
        return;
      }

      const playerId = crypto.randomUUID();
      await db.insert(player).values({ id: playerId, displayName: name, createdAt: now, updatedAt: now });
      await db.insert(playerIdentity).values({
        id: crypto.randomUUID(),
        playerId,
        kind,
        identityKey: key,
        displayName: name,
        createdAt: now,
        updatedAt: now,
      });
    },

    async linkAccountIfMatch(kind: PlayerIdentityKind, key: string) {
      if (kind !== 'minecraft') return; // only Minecraft UUIDs are auto-linkable today
      const account = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.minecraftUuid, key))
        .get();
      if (!account) return;

      const identity = await db
        .select({ playerId: playerIdentity.playerId })
        .from(playerIdentity)
        .where(and(eq(playerIdentity.kind, kind), eq(playerIdentity.identityKey, key)))
        .get();
      if (!identity) return;

      await db
        .update(player)
        .set({ userId: account.id })
        .where(and(eq(player.id, identity.playerId), isNull(player.userId)));
    },
  };
}

// Resolve the server bound to an `Authorization: Bearer <agentToken>` header, or
// null if the token is missing/unknown.
export async function serverIdForAgentToken(db: Db, authHeader: string | null): Promise<string | null> {
  const token = bearerToken(authHeader);
  if (!token) return null;
  const row = await db
    .select({ serverId: serverAgent.serverId })
    .from(serverAgent)
    .where(eq(serverAgent.agentTokenHash, await hashToken(token)))
    .get();
  return row?.serverId ?? null;
}
```

- [ ] **Step 2: Type-check + commit**

Run: `nx build shared`
Expected: PASS.

Add to `libs/shared/src/index.ts`: `export * from './presence-dao';`

```bash
git add libs/shared/src/presence-dao.ts libs/shared/src/index.ts
git commit -s -m "feat(shared): add Drizzle presence DAO and agent-token server resolver"
```

---

## Task 6: `events-ingest` `POST /presence` endpoint

**Files:**
- Modify: `services/events-ingest/src/index.ts`
- Modify: `services/events-ingest/package.json`

> Thin wiring over the Task 4/5 logic; left untested (no Vitest harness in `events-ingest`), consistent with the codebase. Verified by `tsc` here and end-to-end in Task 7.

- [ ] **Step 1: Add deps to `events-ingest`**

In `services/events-ingest/package.json`, add to `devDependencies` (the Worker bundles them at build):

```json
    "@voz/shared": "workspace:*",
    "zod": "^4.4.2"
```

Run: `pnpm install`
Expected: resolves; `@voz/shared` symlinked into `services/events-ingest/node_modules`.

- [ ] **Step 2: Implement the route**

Replace `services/events-ingest/src/index.ts` with:

```ts
import {
  createDb,
  serverIdForAgentToken,
  createPresenceDao,
  handlePresenceBatch,
  parsePresenceBody,
} from '@voz/shared';

interface Env {
  DB: D1Database;
}

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
      return Response.json(result);
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 3: Type-check**

Run: `nx build events-ingest`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/events-ingest/src/index.ts services/events-ingest/package.json pnpm-lock.yaml
git commit -s -m "feat(events-ingest): accept presence event batches at POST /presence"
```

---

## Task 7: Players overview query + `GET /api/players` + `/dashboard/players`

**Files:**
- Create: `libs/shared/src/players.ts`
- Create: `libs/shared/src/players.test.ts`
- Create: `apps/web/src/pages/api/players.ts`
- Create: `apps/web/src/pages/dashboard/players.astro`
- Modify: `apps/web/src/layouts/Dashboard.astro`
- Modify: `libs/shared/src/index.ts`

- [ ] **Step 1: Write the failing test for the pure assembler**

Create `libs/shared/src/players.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assemblePlayersOverview, type OverviewInput } from './players';

const now = new Date('2026-06-13T12:00:00Z');
const d = (s: string) => new Date(s);

const input: OverviewInput = {
  players: [{ id: 'p1', displayName: 'Steve', userId: null }],
  identities: [{ playerId: 'p1', kind: 'minecraft', identityKey: 'u1', displayName: 'Steve' }],
  events: [
    { serverId: 'srvA', type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T10:00:00Z') },
    { serverId: 'srvA', type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T10:30:00Z') },
    { serverId: 'srvB', type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T11:00:00Z') },
    { serverId: 'srvB', type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T11:15:00Z') },
  ],
};

describe('assemblePlayersOverview', () => {
  it('aggregates playtime across servers and lists distinct servers + last seen', () => {
    const [row] = assemblePlayersOverview(input, now);
    expect(row.playerId).toBe('p1');
    expect(row.identityNames).toEqual(['Steve']);
    expect(row.serversSeen.sort()).toEqual(['srvA', 'srvB']);
    expect(row.totalPlaytimeSeconds).toBe(30 * 60 + 15 * 60);
    expect(row.lastSeen).toEqual(d('2026-06-13T11:15:00Z'));
  });

  it('unions multiple identities (alts) into one player total', () => {
    const row = assemblePlayersOverview(
      {
        players: [{ id: 'p1', displayName: 'Steve', userId: null }],
        identities: [
          { playerId: 'p1', kind: 'minecraft', identityKey: 'u1', displayName: 'Steve' },
          { playerId: 'p1', kind: 'minecraft', identityKey: 'u2', displayName: 'SteveAlt' },
        ],
        events: [
          { serverId: 'srvA', type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T10:00:00Z') },
          { serverId: 'srvA', type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T10:10:00Z') },
          { serverId: 'srvA', type: 'join', identityKey: 'u2', occurredAt: d('2026-06-13T11:00:00Z') },
          { serverId: 'srvA', type: 'leave', identityKey: 'u2', occurredAt: d('2026-06-13T11:05:00Z') },
        ],
      },
      now,
    )[0];
    expect(row.totalPlaytimeSeconds).toBe(15 * 60);
    expect(row.identityNames.sort()).toEqual(['Steve', 'SteveAlt']);
  });

  it('omits an event whose identity maps to no known player', () => {
    const rows = assemblePlayersOverview(
      { players: [], identities: [], events: [{ serverId: 'srvA', type: 'join', identityKey: 'ghost', occurredAt: d('2026-06-13T10:00:00Z') }] },
      now,
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `nx test shared`
Expected: FAIL — `Cannot find module './players'`.

- [ ] **Step 3: Implement `players.ts`**

Create `libs/shared/src/players.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { presenceEvents, player, playerIdentity } from './schema';
import { deriveSessions, totalPlaytimeSeconds, type DerivableEvent } from './sessions';
import type { PlayerIdentityKind } from './schema';

export interface OverviewInput {
  players: { id: string; displayName: string | null; userId: string | null }[];
  identities: { playerId: string; kind: PlayerIdentityKind; identityKey: string; displayName: string | null }[];
  events: { serverId: string; type: DerivableEvent['type']; identityKey: string | null; occurredAt: Date }[];
}

export interface PlayerOverviewRow {
  playerId: string;
  displayName: string | null;
  userId: string | null;
  identityNames: string[];
  serversSeen: string[];
  lastSeen: Date | null;
  totalPlaytimeSeconds: number;
}

// Pure aggregation: group events by player (via identity keys), derive sessions
// per server, and sum. Lifecycle events (identityKey === null) are retained per
// server so dangling sessions cap correctly.
export function assemblePlayersOverview(input: OverviewInput, now: Date): PlayerOverviewRow[] {
  const playerByKey = new Map<string, string>();
  const namesByPlayer = new Map<string, Set<string>>();
  const keysByPlayer = new Map<string, Set<string>>();

  for (const p of input.players) {
    namesByPlayer.set(p.id, new Set(p.displayName ? [p.displayName] : []));
    keysByPlayer.set(p.id, new Set());
  }
  for (const id of input.identities) {
    playerByKey.set(id.identityKey, id.playerId);
    keysByPlayer.get(id.playerId)?.add(id.identityKey);
    if (id.displayName) namesByPlayer.get(id.playerId)?.add(id.displayName);
  }

  return input.players.map((p) => {
    const ownKeys = keysByPlayer.get(p.id) ?? new Set<string>();
    // Per-server event slices that touch this player's identities (plus that
    // server's lifecycle events, needed to cap dangling sessions).
    const byServer = new Map<string, DerivableEvent[]>();
    const serversSeen = new Set<string>();
    let lastSeen: Date | null = null;

    for (const e of input.events) {
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
    for (const serverId of serversSeen) {
      const sessions = deriveSessions(byServer.get(serverId) ?? [], now).filter((s) => ownKeys.has(s.identityKey));
      totalSeconds += totalPlaytimeSeconds(sessions);
    }

    return {
      playerId: p.id,
      displayName: p.displayName,
      userId: p.userId,
      identityNames: [...(namesByPlayer.get(p.id) ?? [])],
      serversSeen: [...serversSeen],
      lastSeen,
      totalPlaytimeSeconds: totalSeconds,
    };
  });
  // Every known player is returned, including one seen only via a
  // connection_rejected event (zero sessions) — they still matter operationally.
}

export async function getPlayersOverview(db: Db, now: Date): Promise<PlayerOverviewRow[]> {
  const players = await db
    .select({ id: player.id, displayName: player.displayName, userId: player.userId })
    .from(player)
    .all();
  const identities = await db
    .select({
      playerId: playerIdentity.playerId,
      kind: playerIdentity.kind,
      identityKey: playerIdentity.identityKey,
      displayName: playerIdentity.displayName,
    })
    .from(playerIdentity)
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

  return assemblePlayersOverview({ players, identities, events }, now);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `nx test shared`
Expected: PASS (all three `players` tests).

- [ ] **Step 5: Export from shared**

Add to `libs/shared/src/index.ts`: `export * from './players';`

- [ ] **Step 6: Add the admin-gated JSON route**

Create `apps/web/src/pages/api/players.ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb, getPlayersOverview } from '@voz/shared';
import { isAdmin } from '../../lib/admin';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  if (!isAdmin(ctx.locals.user)) {
    return Response.json({ error: 'Forbidden.' }, { status: 403 });
  }
  const rows = await getPlayersOverview(createDb(env.DB), new Date());
  return Response.json({ players: rows });
};
```

- [ ] **Step 7: Add the bare players page**

Create `apps/web/src/pages/dashboard/players.astro`:

```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
import { createDb, getPlayersOverview } from '@voz/shared';
import { isAdmin } from '../../lib/admin';
import Dashboard from '../../layouts/Dashboard.astro';
import { Card, CardContent } from '../../components/ui/card.tsx';

if (!isAdmin(Astro.locals.user)) {
  return Astro.redirect('/dashboard/profile');
}

const rows = await getPlayersOverview(createDb(env.DB), new Date());

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

    {rows.length === 0 ? (
      <Card className="border-border bg-card">
        <CardContent className="py-12 text-center text-muted-foreground">No players seen yet.</CardContent>
      </Card>
    ) : (
      <div class="overflow-hidden rounded-lg border border-border bg-card">
        <table class="w-full text-sm">
          <thead class="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th class="px-4 py-3 font-medium">Player</th>
              <th class="px-4 py-3 font-medium">Identities</th>
              <th class="px-4 py-3 font-medium">Servers</th>
              <th class="px-4 py-3 font-medium">Last seen</th>
              <th class="px-4 py-3 font-medium">Playtime</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr class="border-t border-border">
                <td class="px-4 py-3">{row.displayName ?? row.identityNames[0] ?? 'Unknown'}</td>
                <td class="px-4 py-3 text-muted-foreground">{row.identityNames.join(', ') || '—'}</td>
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

- [ ] **Step 8: Add the admin nav link**

In `apps/web/src/layouts/Dashboard.astro`, add to the `adminNav` array (first entry):

```ts
  { href: '/dashboard/players', label: 'Players' },
```

- [ ] **Step 9: Build + lint the web app**

Run: `nx build web && nx lint web`
Expected: PASS.

- [ ] **Step 10: End-to-end synthetic verification**

Seed a synthetic player + events and confirm derivation, using the local D1 (the agent isn't built yet). Run from `apps/web`:

```bash
cd apps/web
npx wrangler d1 execute voz-gg --local --command "INSERT INTO player (id, display_name, created_at, updated_at) VALUES ('p_test','Steve',strftime('%s','now'),strftime('%s','now'));"
npx wrangler d1 execute voz-gg --local --command "INSERT INTO player_identity (id, player_id, kind, identity_key, display_name, created_at, updated_at) VALUES ('pi_test','p_test','minecraft','uuid-steve','Steve',strftime('%s','now'),strftime('%s','now'));"
npx wrangler d1 execute voz-gg --local --command "INSERT INTO presence_events (id, server_id, type, identity_kind, identity_key, player_name, occurred_at, dedupe_key) SELECT 'e1', id, 'join','minecraft','uuid-steve','Steve', strftime('%s','now')-3600, 'dk1' FROM servers LIMIT 1;"
npx wrangler d1 execute voz-gg --local --command "INSERT INTO presence_events (id, server_id, type, identity_kind, identity_key, player_name, occurred_at, dedupe_key) SELECT 'e2', id, 'leave','minecraft','uuid-steve','Steve', strftime('%s','now')-1800, 'dk2' FROM servers LIMIT 1;"
```

Then `nx run web:preview`, sign in as an admin account, visit `/dashboard/players`, and confirm Steve shows ~30m playtime and 1 server. (Requires at least one row in `servers`; create one via the Servers page if empty.) Remove the synthetic rows afterward:

```bash
npx wrangler d1 execute voz-gg --local --command "DELETE FROM presence_events WHERE id IN ('e1','e2'); DELETE FROM player_identity WHERE id='pi_test'; DELETE FROM player WHERE id='p_test';"
```

- [ ] **Step 11: Commit**

```bash
git add libs/shared/src/players.ts libs/shared/src/players.test.ts libs/shared/src/index.ts \
  apps/web/src/pages/api/players.ts apps/web/src/pages/dashboard/players.astro apps/web/src/layouts/Dashboard.astro
git commit -s -m "feat(web): add admin players overview at /dashboard/players"
```

---

## Task 8: Document the presence pipeline in AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add a presence section**

Under the "Cloudflare / data" area of `AGENTS.md`, add:

```markdown
### Player presence (#25a)

The `events-ingest` Worker accepts `POST /presence` (Bearer = the server's shared
agent token, validated against `server_agent`). Bodies are batches of events typed
`join | leave | connection_rejected | server_start | server_stop`; minecraft
events carry a UUID (`identity_key`). Events are appended idempotently to
`presence_events` (dedupe via a deterministic `dedupe_key`, since a NULL
identity on lifecycle events defeats a composite UNIQUE). Each minecraft UUID
auto-creates a `player` + `player_identity` and auto-links to a `user` account
with a matching `minecraftUuid`. Sessions and playtime are derived at **read
time** (`libs/shared/src/sessions.ts`); the admin `/dashboard/players` list reads
them via `getPlayersOverview`. The Go `voz-gg-agent logparse` producer ships in
PR-2 (depends on the agent-host-provisioning Go restructure).
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -s -m "docs: document the presence ingest pipeline and event taxonomy"
```

---

## Task 9: Full affected gate + open the PR

- [ ] **Step 1: Run the full affected gate**

Run: `nx run-many -t test,lint,build -p shared web events-ingest`
Expected: all PASS (shared: agent-token + sessions + presence + players suites; web: existing 81 + build + lint; events-ingest: build).

- [ ] **Step 2: Confirm the migration is additive + applies**

Run: `cd apps/web && npx wrangler d1 migrations apply voz-gg --local`
Expected: no pending migrations (already applied in Task 1) — confirms idempotency.

- [ ] **Step 3: Verify every commit carries a DCO trailer**

Run: `git log origin/main..HEAD --format='%h %s' && git log origin/main..HEAD --format=%B | grep -c Signed-off-by`
Expected: the sign-off count equals the number of commits.

- [ ] **Step 4: Push + open the PR**

```bash
git push -u origin worktree-presence-identity-foundation
gh pr create --base main \
  --title "feat: presence & identity foundation ingest + data model (#25a PR-1)" \
  --body "$(cat <<'EOF'
Implements PR-1 of #25a (presence & identity foundation): the backend + data half.

## What
- New D1 tables: `presence_events` (append-only, idempotent via `dedupe_key`), `player`, `player_identity` (multi-identity, kinds minecraft/steam/discord).
- `events-ingest` `POST /presence`: shared-agent-token auth, idempotent batch insert, auto-create player/identity, auto-link to matching `user` account.
- Read-time session/playtime derivation (`libs/shared/src/sessions.ts`).
- Admin `/dashboard/players` overview + `GET /api/players`.
- Agent token helpers extracted to `libs/shared` (DRY across web + events-ingest).

## Not in this PR
- PR-2: the `voz-gg-agent logparse` Go daemon that produces these events — depends on the agent-host-provisioning Go restructure landing first.
- #25b/#25c: player/server views, notes, groups, merge UI, notifications.

## Testing
- `nx run-many -t test,lint,build -p shared web events-ingest` green.
- Synthetic D1 seed verified `/dashboard/players` playtime aggregation.

Spec: `docs/superpowers/specs/2026-06-13-presence-identity-foundation-design.md`
Plan: `docs/superpowers/plans/2026-06-13-presence-identity-foundation-pr1.md`
EOF
)"
```

Expected: PR created against `main`. CI (commitlint over the range, nx affected lint/test/build, DCO) should pass.

---

## Self-Review notes (already reconciled)

- **Spec coverage:** schema (Task 1), shared token auth (Task 2), session derivation (Task 3), idempotent ingest + auto-create/link (Tasks 4–6), read surface (Task 7), docs (Task 8). PR-2 (Go daemon) is explicitly out of scope.
- **Type consistency:** `PresenceDao` (insertEvent/ensurePlayerIdentity/linkAccountIfMatch) defined in Task 4 is implemented verbatim in Task 5 and consumed in Task 6; `IngestEvent`/`PresenceEventRow`/`DerivableEvent`/`PlayerOverviewRow` names are reused consistently across tasks.
- **`occurredAt` units:** the wire/`occurredAt` is **epoch seconds** end-to-end (`parsePresenceBody` multiplies by 1000; `buildDedupeKey` divides by 1000; D1 `timestamp` mode stores seconds), so `dedupe_key` is stable regardless of sub-second drift.
