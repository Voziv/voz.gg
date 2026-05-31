# Live Server Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real Online·N/M / Offline / Unknown per game server, gathered by a co-located Go agent that probes `127.0.0.1:<port>` locally and pushes status to token-authed Worker endpoints.

**Architecture:** A per-box Go `status-monitor` agent enrolls with a one-time token (exchanged for a long-lived hashed agent token), probes the local game port with a `gameType`-selected prober (SLP / A2S / TCP), and `POST`s status to the Worker. The Worker computes an opaque `configHash` from the `servers` row on every report; on mismatch the agent re-pulls config. The Astro servers page left-joins `server_status` and applies a staleness window so a dead agent reads as Unknown.

**Tech Stack:** Go 1.24 (single root `go.mod`, module `voz.gg`, nx-go targets) · Astro 6 SSR on Cloudflare Workers + React islands · Drizzle/D1 (`@voz/shared`) · Vitest (node env) · Web Crypto `crypto.subtle` for hashing.

---

## Design notes (read before starting)

- **Vitest runs in the plain `node` environment** (`apps/web/vitest.config.ts`, `include: ['src/**/*.test.ts']`). There is **no D1 / better-sqlite3 / miniflare** available. Therefore route DB logic is extracted into **pure functions that accept an injected data-access object** and tested with a hand-rolled fake. The `.ts` API route files stay thin (env + `createDb` + delegate) and are verified by `nx lint web` + `nx build web`, not unit tests. This matches the spec's "Routes/agent wiring that need integration are build/lint-verified."
- **`crypto.subtle` is available** in the node test env (verified). All hashing uses it (async).
- **The agent treats `configHash` as opaque.** Only the Worker computes it. The Go side never canonicalizes JSON for hashing — it just stores and echoes the string.
- **Tokens** are random (Worker: `crypto.randomUUID()` joined; agent never generates tokens). Stored as SHA-256 hex. Plaintext shown to the user only at mint time.
- **DRY:** the canonical-JSON + SHA-256-hex helper lives once in `agent-config.ts` and is reused by `agent-auth.ts` (token hashing is plain SHA-256 of the token string).

## File structure

| path | responsibility |
|------|----------------|
| `libs/shared/src/schema.ts` | add `serverStatus` + `serverAgent` Drizzle tables |
| `apps/web/drizzle/migrations/0004_*.sql` | generated D1 migration for the two tables |
| `apps/web/src/lib/agent-config.ts` | `buildAgentConfig(server)`, `canonicalJson`, `sha256Hex`, `configHash(config)` |
| `apps/web/src/lib/agent-config.test.ts` | hash determinism + canonicalization tests |
| `apps/web/src/lib/agent-auth.ts` | `hashToken`, `generateToken`, `serverIdForToken(dao, token)` |
| `apps/web/src/lib/agent-auth.test.ts` | token hashing + resolution tests |
| `apps/web/src/lib/agent-handlers.ts` | pure enroll/config/status logic over an injected `AgentDao` |
| `apps/web/src/lib/agent-handlers.test.ts` | enroll mint→consume→reject reuse, status upsert, config pull |
| `apps/web/src/lib/agent-dao.ts` | `AgentDao` interface + `createAgentDao(db)` Drizzle impl |
| `apps/web/src/pages/api/agents/enroll.ts` | `POST` thin route → `handleEnroll` |
| `apps/web/src/pages/api/agents/config.ts` | `GET` thin route → `handleConfig` |
| `apps/web/src/pages/api/status.ts` | `POST` thin route → `handleStatus` |
| `apps/web/src/pages/api/servers/index.ts` | edit — mint enrollment token on create |
| `apps/web/src/pages/api/servers/[id]/agent/regenerate.ts` | `POST` admin regenerate |
| `apps/web/src/lib/route-protection.ts` | allowlist the 3 agent paths |
| `apps/web/src/lib/route-protection.test.ts` | assert the 3 paths are public |
| `apps/web/src/lib/status-display.ts` | `displayStatus(row, pollSeconds, now)` staleness logic |
| `apps/web/src/lib/status-display.test.ts` | staleness tests |
| `apps/web/src/components/dashboard/StatusBadge.tsx` | real props component |
| `apps/web/src/components/dashboard/StatusBadge.test.tsx` | render-state tests |
| `apps/web/src/components/dashboard/AgentInstallDialog.tsx` | show install one-liner / regenerate |
| `apps/web/src/components/dashboard/ServerFormDialog.tsx` | surface returned enrollment token on create |
| `apps/web/src/pages/dashboard/servers.astro` | left-join `server_status` + staleness |
| `apps/web/public/install-agent.sh` | install script |
| `libs/go-shared/report.go` | add `Post`/`Send` transport helper |
| `libs/go-shared/report_test.go` | `Post` bearer header + JSON decode test |
| `services/status-monitor/config.go` | load/save JSON config |
| `services/status-monitor/config_test.go` | round-trip load/save |
| `services/status-monitor/prober/prober.go` | `Status` + `Prober` types |
| `services/status-monitor/prober/slp.go` | Minecraft SLP prober |
| `services/status-monitor/prober/slp_test.go` | SLP parse against synthesized response |
| `services/status-monitor/prober/a2s.go` | Source A2S_INFO prober |
| `services/status-monitor/prober/a2s_test.go` | A2S parse incl. challenge round-trip |
| `services/status-monitor/prober/tcp.go` | TCP connect prober |
| `services/status-monitor/prober/tcp_test.go` | TCP prober against `net.Listen` |
| `services/status-monitor/prober/registry.go` | `For(gameType)` + query-port defaults |
| `services/status-monitor/prober/registry_test.go` | registry mapping tests |
| `services/status-monitor/agent.go` | probe → report → config re-pull loop body |
| `services/status-monitor/agent_test.go` | report loop against `httptest` server |
| `services/status-monitor/main.go` | flags + loop wiring (replaces stub) |

---

## Task 1: Schema + migration

**Files:**
- Modify: `libs/shared/src/schema.ts`
- Generate: `apps/web/drizzle/migrations/0004_*.sql`

- [ ] **Step 1: Add the two tables to the schema**

Append to `libs/shared/src/schema.ts` (after the `servers` table):

```ts
export const serverStatus = sqliteTable('server_status', {
  serverId: text('server_id')
    .primaryKey()
    .references(() => servers.id, { onDelete: 'cascade' }),
  status: text('status').notNull(), // 'online' | 'offline' | 'unknown'
  players: integer('players'),
  maxPlayers: integer('max_players'),
  version: text('version'),
  latencyMs: integer('latency_ms'),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
});

export const serverAgent = sqliteTable('server_agent', {
  serverId: text('server_id')
    .primaryKey()
    .references(() => servers.id, { onDelete: 'cascade' }),
  enrollmentTokenHash: text('enrollment_token_hash'),
  agentTokenHash: text('agent_token_hash'),
  enrolledAt: integer('enrolled_at', { mode: 'timestamp' }),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
});
```

- [ ] **Step 2: Generate the migration**

Run:

```bash
cd apps/web && npx drizzle-kit generate
```

Expected: a new `apps/web/drizzle/migrations/0004_*.sql` containing `CREATE TABLE \`server_status\`` and `CREATE TABLE \`server_agent\``, plus updated `meta/`. (Do not hand-edit the generated file.)

- [ ] **Step 3: Apply locally**

Run:

```bash
cd apps/web && npx wrangler d1 migrations apply voz-gg --local
```

Expected: reports the `0004` migration applied with no errors. (For production: `npx wrangler d1 migrations apply voz-gg --remote` — document only, do not run here.)

- [ ] **Step 4: Verify the shared lib still builds and types export**

Run:

```bash
npx nx build shared
```

Expected: build succeeds; `serverStatus` and `serverAgent` are exported via `@voz/shared` (re-exported by `libs/shared/src/index.ts` through `export * from './schema'`).

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/schema.ts apps/web/drizzle/migrations
git -c commit.gpgsign=false commit -m "feat(shared): add server_status and server_agent tables"
```

---

## Task 2: `agent-config.ts` — config builder + opaque hash

**Files:**
- Create: `apps/web/src/lib/agent-config.ts`
- Test: `apps/web/src/lib/agent-config.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/agent-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAgentConfig, configHash, canonicalJson } from './agent-config';

const server = {
  id: 'srv123',
  gameType: 'minecraft-java' as const,
  port: 25565,
  queryPort: 0,
  pollIntervalSeconds: 30,
};

describe('buildAgentConfig', () => {
  it('builds the config shape with a localhost probeHost', () => {
    expect(buildAgentConfig(server)).toEqual({
      serverId: 'srv123',
      gameType: 'minecraft-java',
      probeHost: '127.0.0.1',
      port: 25565,
      queryPort: 0,
      pollIntervalSeconds: 30,
    });
  });

  it('defaults queryPort and pollIntervalSeconds when omitted', () => {
    expect(buildAgentConfig({ id: 's', gameType: 'source', port: 27015 })).toEqual({
      serverId: 's',
      gameType: 'source',
      probeHost: '127.0.0.1',
      port: 27015,
      queryPort: 0,
      pollIntervalSeconds: 30,
    });
  });
});

describe('canonicalJson', () => {
  it('sorts keys so property order does not affect output', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe('configHash', () => {
  it('is a 64-char lowercase hex SHA-256 digest', async () => {
    const h = await configHash(buildAgentConfig(server));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic regardless of input key order', async () => {
    const a = await configHash({ port: 25565, serverId: 'x', gameType: 'source', probeHost: '127.0.0.1', queryPort: 0, pollIntervalSeconds: 30 });
    const b = await configHash({ serverId: 'x', gameType: 'source', probeHost: '127.0.0.1', port: 25565, queryPort: 0, pollIntervalSeconds: 30 });
    expect(a).toBe(b);
  });

  it('changes when the port changes (so a #5 edit re-syncs the agent)', async () => {
    const base = buildAgentConfig(server);
    const a = await configHash(base);
    const b = await configHash({ ...base, port: 25566 });
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx nx test web -- agent-config`
Expected: FAIL — `Cannot find module './agent-config'`.

- [ ] **Step 3: Implement `agent-config.ts`**

`apps/web/src/lib/agent-config.ts`:

```ts
import type { GameType } from '@voz/shared';

export interface AgentConfig {
  serverId: string;
  gameType: GameType;
  probeHost: string;
  port: number;
  queryPort: number;
  pollIntervalSeconds: number;
}

interface ServerConfigInput {
  id: string;
  gameType: GameType;
  port: number;
  queryPort?: number | null;
  pollIntervalSeconds?: number | null;
}

const DEFAULT_POLL_INTERVAL_SECONDS = 30;

export function buildAgentConfig(server: ServerConfigInput): AgentConfig {
  return {
    serverId: server.id,
    gameType: server.gameType,
    probeHost: '127.0.0.1',
    port: server.port,
    queryPort: server.queryPort ?? 0,
    pollIntervalSeconds: server.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS,
  };
}

// Stable JSON with recursively sorted object keys. The agent treats the hash as
// opaque, so this canonical form only has to be consistent on the Worker side.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function configHash(config: AgentConfig): Promise<string> {
  return sha256Hex(canonicalJson(config));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx nx test web -- agent-config`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/agent-config.ts apps/web/src/lib/agent-config.test.ts
git -c commit.gpgsign=false commit -m "feat(web): add agent config builder and opaque config hash"
```

---

## Task 3: `agent-auth.ts` — token hash + resolution

**Files:**
- Create: `apps/web/src/lib/agent-auth.ts`
- Test: `apps/web/src/lib/agent-auth.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/agent-auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashToken, generateToken, serverIdForToken } from './agent-auth';

describe('hashToken', () => {
  it('returns a 64-char hex digest and is deterministic', async () => {
    const a = await hashToken('abc');
    const b = await hashToken('abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different tokens', async () => {
    expect(await hashToken('abc')).not.toBe(await hashToken('abd'));
  });
});

describe('generateToken', () => {
  it('produces a long unique opaque string', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe('serverIdForToken', () => {
  it('resolves the serverId whose agentTokenHash matches', async () => {
    const token = 'agent-token-xyz';
    const hash = await hashToken(token);
    const dao = { findServerIdByAgentTokenHash: async (h: string) => (h === hash ? 'srv1' : null) };
    expect(await serverIdForToken(dao, token)).toBe('srv1');
  });

  it('returns null for an unknown token', async () => {
    const dao = { findServerIdByAgentTokenHash: async () => null };
    expect(await serverIdForToken(dao, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx nx test web -- agent-auth`
Expected: FAIL — `Cannot find module './agent-auth'`.

- [ ] **Step 3: Implement `agent-auth.ts`**

`apps/web/src/lib/agent-auth.ts`:

```ts
import { sha256Hex } from './agent-config';

export function generateToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}

export function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export interface TokenResolver {
  findServerIdByAgentTokenHash(hash: string): Promise<string | null>;
}

export async function serverIdForToken(dao: TokenResolver, token: string): Promise<string | null> {
  return dao.findServerIdByAgentTokenHash(await hashToken(token));
}

// Pulls the raw token out of an `Authorization: Bearer <token>` header value.
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx nx test web -- agent-auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/agent-auth.ts apps/web/src/lib/agent-auth.test.ts
git -c commit.gpgsign=false commit -m "feat(web): add agent token hashing and resolution"
```

---

## Task 4: `agent-dao.ts` — data-access interface + Drizzle impl

**Files:**
- Create: `apps/web/src/lib/agent-dao.ts`

This task has no unit test of its own (it is a thin Drizzle adapter, build/lint-verified). The next task tests the handlers against a fake implementing this interface.

- [ ] **Step 1: Implement the DAO**

`apps/web/src/lib/agent-dao.ts`:

```ts
import { eq } from 'drizzle-orm';
import { serverAgent, serverStatus, servers, type Db } from '@voz/shared';
import type { TokenResolver } from './agent-auth';

export interface ServerRow {
  id: string;
  gameType: import('@voz/shared').GameType;
  port: number;
}

export interface StatusUpsert {
  serverId: string;
  status: string;
  players: number | null;
  maxPlayers: number | null;
  version: string | null;
  latencyMs: number | null;
  checkedAt: Date;
}

export interface AgentDao extends TokenResolver {
  findServerByEnrollmentTokenHash(hash: string): Promise<ServerRow | null>;
  serverById(serverId: string): Promise<ServerRow | null>;
  completeEnrollment(serverId: string, agentTokenHash: string, enrolledAt: Date): Promise<void>;
  upsertStatus(row: StatusUpsert): Promise<void>;
  touchLastSeen(serverId: string, at: Date): Promise<void>;
}

export function createAgentDao(db: Db): AgentDao {
  const selectServer = (serverId: string) =>
    db
      .select({ id: servers.id, gameType: servers.gameType, port: servers.port })
      .from(servers)
      .where(eq(servers.id, serverId))
      .get();

  return {
    async findServerIdByAgentTokenHash(hash) {
      const row = await db
        .select({ serverId: serverAgent.serverId })
        .from(serverAgent)
        .where(eq(serverAgent.agentTokenHash, hash))
        .get();
      return row?.serverId ?? null;
    },

    async findServerByEnrollmentTokenHash(hash) {
      const agent = await db
        .select({ serverId: serverAgent.serverId, agentTokenHash: serverAgent.agentTokenHash })
        .from(serverAgent)
        .where(eq(serverAgent.enrollmentTokenHash, hash))
        .get();
      // One-time use: a matching enrollment hash that is already enrolled is rejected upstream,
      // but enrollmentTokenHash is nulled on completion so a used token will not match here at all.
      if (!agent) return null;
      return (await selectServer(agent.serverId)) ?? null;
    },

    async serverById(serverId) {
      return (await selectServer(serverId)) ?? null;
    },

    async completeEnrollment(serverId, agentTokenHash, enrolledAt) {
      await db
        .update(serverAgent)
        .set({ agentTokenHash, enrolledAt, enrollmentTokenHash: null })
        .where(eq(serverAgent.serverId, serverId));
    },

    async upsertStatus(row) {
      await db
        .insert(serverStatus)
        .values(row)
        .onConflictDoUpdate({
          target: serverStatus.serverId,
          set: {
            status: row.status,
            players: row.players,
            maxPlayers: row.maxPlayers,
            version: row.version,
            latencyMs: row.latencyMs,
            checkedAt: row.checkedAt,
          },
        });
    },

    async touchLastSeen(serverId, at) {
      await db.update(serverAgent).set({ lastSeenAt: at }).where(eq(serverAgent.serverId, serverId));
    },
  };
}
```

- [ ] **Step 2: Type-check via build**

Run: `npx nx build shared && npx nx lint web`
Expected: no type/lint errors referencing `agent-dao.ts`. (Full build is exercised in Task 9 / final verification.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/agent-dao.ts
git -c commit.gpgsign=false commit -m "feat(web): add agent data-access layer"
```

---

## Task 5: `agent-handlers.ts` — pure enroll/config/status logic

**Files:**
- Create: `apps/web/src/lib/agent-handlers.ts`
- Test: `apps/web/src/lib/agent-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/agent-handlers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handleEnroll, handleConfig, handleStatus } from './agent-handlers';
import { hashToken } from './agent-auth';
import { buildAgentConfig, configHash } from './agent-config';
import type { AgentDao, ServerRow, StatusUpsert } from './agent-dao';

const server: ServerRow = { id: 'srv1', gameType: 'minecraft-java', port: 25565 };

function fakeDao(overrides: Partial<AgentDao> = {}) {
  const calls: { upserts: StatusUpsert[]; lastSeen: string[]; enrolled: string[] } = {
    upserts: [],
    lastSeen: [],
    enrolled: [],
  };
  const dao: AgentDao = {
    findServerIdByAgentTokenHash: async () => null,
    findServerByEnrollmentTokenHash: async () => null,
    serverById: async (id) => (id === server.id ? server : null),
    completeEnrollment: async (id) => {
      calls.enrolled.push(id);
    },
    upsertStatus: async (row) => {
      calls.upserts.push(row);
    },
    touchLastSeen: async (id) => {
      calls.lastSeen.push(id);
    },
    ...overrides,
  };
  return { dao, calls };
}

describe('handleEnroll', () => {
  it('mints + hashes an agent token, completes enrollment, returns config + hash', async () => {
    const { dao, calls } = fakeDao({ findServerByEnrollmentTokenHash: async () => server });
    const res = await handleEnroll(dao, { enrollmentToken: 'enroll-1' });
    expect(res.status).toBe(200);
    const body = res.body as { agentToken: string; config: unknown; configHash: string };
    expect(body.agentToken.length).toBeGreaterThanOrEqual(32);
    expect(body.config).toEqual(buildAgentConfig(server));
    expect(body.configHash).toBe(await configHash(buildAgentConfig(server)));
    expect(calls.enrolled).toEqual(['srv1']);
  });

  it('rejects an unknown / already-used enrollment token with 401', async () => {
    const { dao } = fakeDao({ findServerByEnrollmentTokenHash: async () => null });
    const res = await handleEnroll(dao, { enrollmentToken: 'used' });
    expect(res.status).toBe(401);
  });

  it('rejects a missing token with 400', async () => {
    const { dao } = fakeDao();
    const res = await handleEnroll(dao, {});
    expect(res.status).toBe(400);
  });
});

describe('handleConfig', () => {
  it('returns config + hash for a resolved server', async () => {
    const { dao } = fakeDao();
    const res = await handleConfig(dao, server.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      config: buildAgentConfig(server),
      configHash: await configHash(buildAgentConfig(server)),
    });
  });

  it('returns 401 when the server cannot be resolved', async () => {
    const { dao } = fakeDao({ serverById: async () => null });
    const res = await handleConfig(dao, 'missing');
    expect(res.status).toBe(401);
  });
});

describe('handleStatus', () => {
  it('upserts status, touches lastSeen, and returns the current configHash', async () => {
    const { dao, calls } = fakeDao();
    const now = new Date('2026-05-31T00:00:00Z');
    const res = await handleStatus(
      dao,
      server.id,
      { status: 'online', players: 12, maxPlayers: 50, version: '1.21', latencyMs: 23, configHash: 'stale' },
      now,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configHash: await configHash(buildAgentConfig(server)) });
    expect(calls.upserts[0]).toEqual({
      serverId: 'srv1',
      status: 'online',
      players: 12,
      maxPlayers: 50,
      version: '1.21',
      latencyMs: 23,
      checkedAt: now,
    });
    expect(calls.lastSeen).toEqual(['srv1']);
  });

  it('coerces omitted optional fields to null', async () => {
    const { dao, calls } = fakeDao();
    const now = new Date('2026-05-31T00:00:00Z');
    await handleStatus(dao, server.id, { status: 'offline', configHash: 'x' }, now);
    expect(calls.upserts[0]).toMatchObject({ players: null, maxPlayers: null, version: null, latencyMs: null });
  });

  it('rejects a body with no status (400)', async () => {
    const { dao } = fakeDao();
    const res = await handleStatus(dao, server.id, { configHash: 'x' }, new Date());
    expect(res.status).toBe(400);
  });

  it('returns 401 when the server cannot be resolved', async () => {
    const { dao } = fakeDao({ serverById: async () => null });
    const res = await handleStatus(dao, 'missing', { status: 'online', configHash: 'x' }, new Date());
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx nx test web -- agent-handlers`
Expected: FAIL — `Cannot find module './agent-handlers'`.

- [ ] **Step 3: Implement `agent-handlers.ts`**

`apps/web/src/lib/agent-handlers.ts`:

```ts
import { z } from 'zod';
import type { AgentDao, ServerRow } from './agent-dao';
import { buildAgentConfig, configHash } from './agent-config';
import { generateToken, hashToken } from './agent-auth';

export interface HandlerResult {
  status: number;
  body: unknown;
}

const VALID_STATUSES = ['online', 'offline', 'unknown'] as const;

const statusBodySchema = z.object({
  status: z.enum(VALID_STATUSES),
  players: z.number().int().nonnegative().nullish(),
  maxPlayers: z.number().int().nonnegative().nullish(),
  version: z.string().max(200).nullish(),
  latencyMs: z.number().int().nonnegative().nullish(),
  configHash: z.string(),
});

async function configResponse(server: ServerRow) {
  const config = buildAgentConfig(server);
  return { config, configHash: await configHash(config) };
}

export async function handleEnroll(dao: AgentDao, body: unknown): Promise<HandlerResult> {
  const parsed = z.object({ enrollmentToken: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: 'Missing enrollment token.' } };

  const enrollmentHash = await hashToken(parsed.data.enrollmentToken);
  const server = await dao.findServerByEnrollmentTokenHash(enrollmentHash);
  if (!server) return { status: 401, body: { error: 'Invalid or used enrollment token.' } };

  const agentToken = generateToken();
  await dao.completeEnrollment(server.id, await hashToken(agentToken), new Date());

  const { config, configHash: hash } = await configResponse(server);
  return { status: 200, body: { agentToken, config, configHash: hash } };
}

export async function handleConfig(dao: AgentDao, serverId: string | null): Promise<HandlerResult> {
  if (!serverId) return { status: 401, body: { error: 'Unauthorized.' } };
  const server = await dao.serverById(serverId);
  if (!server) return { status: 401, body: { error: 'Unauthorized.' } };
  return { status: 200, body: await configResponse(server) };
}

export async function handleStatus(
  dao: AgentDao,
  serverId: string | null,
  body: unknown,
  now: Date,
): Promise<HandlerResult> {
  if (!serverId) return { status: 401, body: { error: 'Unauthorized.' } };
  const server = await dao.serverById(serverId);
  if (!server) return { status: 401, body: { error: 'Unauthorized.' } };

  const parsed = statusBodySchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: 'Invalid status body.' } };

  await dao.upsertStatus({
    serverId,
    status: parsed.data.status,
    players: parsed.data.players ?? null,
    maxPlayers: parsed.data.maxPlayers ?? null,
    version: parsed.data.version ?? null,
    latencyMs: parsed.data.latencyMs ?? null,
    checkedAt: now,
  });
  await dao.touchLastSeen(serverId, now);

  return { status: 200, body: { configHash: (await configResponse(server)).configHash } };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx nx test web -- agent-handlers`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/agent-handlers.ts apps/web/src/lib/agent-handlers.test.ts
git -c commit.gpgsign=false commit -m "feat(web): add pure agent enroll/config/status handlers"
```

---

## Task 6: Agent API routes + allowlist

**Files:**
- Create: `apps/web/src/pages/api/agents/enroll.ts`
- Create: `apps/web/src/pages/api/agents/config.ts`
- Create: `apps/web/src/pages/api/status.ts`
- Modify: `apps/web/src/lib/route-protection.ts`
- Modify: `apps/web/src/lib/route-protection.test.ts`

- [ ] **Step 1: Write the failing allowlist test**

Replace the first `it.each` block in `apps/web/src/lib/route-protection.test.ts` to add the agent paths:

```ts
import { describe, it, expect } from 'vitest';
import { isPublicPath } from './route-protection';

describe('isPublicPath', () => {
  it.each([
    '/',
    '/sign-in',
    '/api/auth/sign-in/social',
    '/api/auth/callback/discord',
    '/api/auth/steam/initiate',
    '/api/agents/enroll',
    '/api/agents/config',
    '/api/status',
  ])('treats %s as public', (p) => expect(isPublicPath(p)).toBe(true));

  it.each(['/dashboard', '/dashboard/profile', '/dashboard/servers'])(
    'treats %s as protected',
    (p) => expect(isPublicPath(p)).toBe(false),
  );
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx nx test web -- route-protection`
Expected: FAIL — `/api/agents/enroll` is not yet public.

- [ ] **Step 3: Add the allowlist entries**

Edit `apps/web/src/lib/route-protection.ts`:

```ts
const PUBLIC_EXACT = new Set(['/', '/sign-in', '/api/agents/enroll', '/api/agents/config', '/api/status']);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  // All better-auth + Steam endpoints live under /api/auth and guard themselves.
  if (pathname.startsWith('/api/auth/')) return true;
  return false;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx nx test web -- route-protection`
Expected: PASS.

- [ ] **Step 5: Write the three thin route files**

`apps/web/src/pages/api/agents/enroll.ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { createAgentDao } from '../../../lib/agent-dao';
import { handleEnroll } from '../../../lib/agent-handlers';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const dao = createAgentDao(createDb(env.DB));
  const body = await ctx.request.json().catch(() => ({}));
  const result = await handleEnroll(dao, body);
  return Response.json(result.body, { status: result.status });
};
```

`apps/web/src/pages/api/agents/config.ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { createAgentDao } from '../../../lib/agent-dao';
import { handleConfig } from '../../../lib/agent-handlers';
import { bearerToken, serverIdForToken } from '../../../lib/agent-auth';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const dao = createAgentDao(createDb(env.DB));
  const token = bearerToken(ctx.request.headers.get('authorization'));
  const serverId = token ? await serverIdForToken(dao, token) : null;
  const result = await handleConfig(dao, serverId);
  return Response.json(result.body, { status: result.status });
};
```

`apps/web/src/pages/api/status.ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { createAgentDao } from '../../lib/agent-dao';
import { handleStatus } from '../../lib/agent-handlers';
import { bearerToken, serverIdForToken } from '../../lib/agent-auth';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const dao = createAgentDao(createDb(env.DB));
  const token = bearerToken(ctx.request.headers.get('authorization'));
  const serverId = token ? await serverIdForToken(dao, token) : null;
  const body = await ctx.request.json().catch(() => ({}));
  const result = await handleStatus(dao, serverId, body, new Date());
  return Response.json(result.body, { status: result.status });
};
```

- [ ] **Step 6: Lint + build to verify wiring**

Run: `npx nx lint web && npx nx build web`
Expected: both pass (routes type-check against `cloudflare:workers` env + `@voz/shared`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/api/agents apps/web/src/pages/api/status.ts apps/web/src/lib/route-protection.ts apps/web/src/lib/route-protection.test.ts
git -c commit.gpgsign=false commit -m "feat(web): add agent enroll/config/status endpoints"
```

---

## Task 7: Mint enrollment token on server create + regenerate route

**Files:**
- Modify: `apps/web/src/pages/api/servers/index.ts`
- Create: `apps/web/src/pages/api/servers/[id]/agent/regenerate.ts`

These are admin-session routes that need D1, so they are build/lint-verified (the token-minting logic reuses the already-tested `generateToken` + `hashToken`).

- [ ] **Step 1: Extend the create route to mint an enrollment token**

Replace `apps/web/src/pages/api/servers/index.ts` with:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { nanoid } from 'nanoid';
import { createDb, servers, serverAgent } from '@voz/shared';
import { isAdmin } from '../../../lib/admin';
import { parseServerInput } from '../../../lib/server-schema';
import { generateToken, hashToken } from '../../../lib/agent-auth';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const parsed = parseServerInput(await ctx.request.json().catch(() => ({})));
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const db = createDb(env.DB);
  const id = nanoid(12);
  const now = new Date();
  await db.insert(servers).values({
    id,
    name: parsed.data.name,
    gameType: parsed.data.gameType,
    host: parsed.data.host,
    port: parsed.data.port,
    description: parsed.data.description,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  });

  const enrollmentToken = generateToken();
  await db.insert(serverAgent).values({
    serverId: id,
    enrollmentTokenHash: await hashToken(enrollmentToken),
  });

  return Response.json({ ok: true, id, enrollmentToken });
};
```

- [ ] **Step 2: Add the regenerate route**

`apps/web/src/pages/api/servers/[id]/agent/regenerate.ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, servers, serverAgent } from '@voz/shared';
import { isAdmin } from '../../../../../lib/admin';
import { generateToken, hashToken } from '../../../../../lib/agent-auth';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const id = ctx.params.id;
  if (!id) return new Response('Bad Request', { status: 400 });

  const db = createDb(env.DB);
  const server = await db.select({ id: servers.id }).from(servers).where(eq(servers.id, id)).get();
  if (!server) return Response.json({ ok: false, error: 'Server not found.' }, { status: 404 });

  const enrollmentToken = generateToken();
  const enrollmentTokenHash = await hashToken(enrollmentToken);
  // Regenerating invalidates the old agent token (revoke) and re-arms enrollment.
  await db
    .insert(serverAgent)
    .values({ serverId: id, enrollmentTokenHash })
    .onConflictDoUpdate({
      target: serverAgent.serverId,
      set: { enrollmentTokenHash, agentTokenHash: null, enrolledAt: null },
    });

  return Response.json({ ok: true, enrollmentToken });
};
```

- [ ] **Step 3: Lint + build**

Run: `npx nx lint web && npx nx build web`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/api/servers/index.ts "apps/web/src/pages/api/servers/[id]/agent/regenerate.ts"
git -c commit.gpgsign=false commit -m "feat(web): mint enrollment token on server create and add regenerate route"
```

---

## Task 8: Real `StatusBadge` + staleness display logic

**Files:**
- Modify: `apps/web/src/components/dashboard/StatusBadge.tsx`
- Test: `apps/web/src/components/dashboard/StatusBadge.test.tsx`
- Create: `apps/web/src/lib/status-display.ts`
- Test: `apps/web/src/lib/status-display.test.ts`

> Note: `StatusBadge.test.tsx` is a `.tsx` test — Vitest's `include` is `src/**/*.test.ts`, which does **not** match `.test.tsx`. Update the include glob in this task so the component test runs.

- [ ] **Step 1: Broaden the Vitest include glob**

Edit `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

- [ ] **Step 2: Write the failing staleness test**

`apps/web/src/lib/status-display.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { displayStatus } from './status-display';

const now = new Date('2026-05-31T12:00:00Z');

describe('displayStatus', () => {
  it('returns unknown when there is no status row', () => {
    expect(displayStatus(null, 30, now)).toEqual({ status: 'unknown' });
  });

  it('passes through a fresh online row with player counts', () => {
    const row = { status: 'online', players: 5, maxPlayers: 20, checkedAt: new Date(now.getTime() - 10_000) };
    expect(displayStatus(row, 30, now)).toEqual({ status: 'online', players: 5, maxPlayers: 20 });
  });

  it('passes through a fresh offline row', () => {
    const row = { status: 'offline', players: null, maxPlayers: null, checkedAt: new Date(now.getTime() - 5_000) };
    expect(displayStatus(row, 30, now)).toEqual({ status: 'offline', players: undefined, maxPlayers: undefined });
  });

  it('downgrades a stale row to unknown (older than 3x the poll interval)', () => {
    const row = { status: 'online', players: 5, maxPlayers: 20, checkedAt: new Date(now.getTime() - 91_000) };
    expect(displayStatus(row, 30, now)).toEqual({ status: 'unknown' });
  });

  it('treats a row exactly at the threshold as fresh', () => {
    const row = { status: 'online', players: 1, maxPlayers: 2, checkedAt: new Date(now.getTime() - 90_000) };
    expect(displayStatus(row, 30, now)).toEqual({ status: 'online', players: 1, maxPlayers: 2 });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx nx test web -- status-display`
Expected: FAIL — `Cannot find module './status-display'`.

- [ ] **Step 4: Implement `status-display.ts`**

`apps/web/src/lib/status-display.ts`:

```ts
export type DisplayStatus = 'online' | 'offline' | 'unknown';

export interface StatusRow {
  status: string;
  players: number | null;
  maxPlayers: number | null;
  checkedAt: Date;
}

export interface DisplayResult {
  status: DisplayStatus;
  players?: number;
  maxPlayers?: number;
}

const STALENESS_POLL_MULTIPLIER = 3;

export function displayStatus(
  row: StatusRow | null,
  pollIntervalSeconds: number,
  now: Date,
): DisplayResult {
  if (!row) return { status: 'unknown' };
  const staleThresholdMs = pollIntervalSeconds * STALENESS_POLL_MULTIPLIER * 1000;
  if (now.getTime() - row.checkedAt.getTime() > staleThresholdMs) return { status: 'unknown' };
  return {
    status: row.status as DisplayStatus,
    players: row.players ?? undefined,
    maxPlayers: row.maxPlayers ?? undefined,
  };
}
```

- [ ] **Step 5: Run the staleness test and confirm it passes**

Run: `npx nx test web -- status-display`
Expected: PASS.

- [ ] **Step 6: Write the failing `StatusBadge` test**

`apps/web/src/components/dashboard/StatusBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders Online with N/M when online with counts', () => {
    const html = renderToStaticMarkup(<StatusBadge status="online" players={12} maxPlayers={50} />);
    expect(html).toContain('Online');
    expect(html).toContain('12');
    expect(html).toContain('50');
  });

  it('renders just Online when player counts are absent', () => {
    const html = renderToStaticMarkup(<StatusBadge status="online" />);
    expect(html).toContain('Online');
    expect(html).not.toMatch(/\b\d+\s*\/\s*\d+/);
  });

  it('renders Offline', () => {
    const html = renderToStaticMarkup(<StatusBadge status="offline" />);
    expect(html).toContain('Offline');
  });

  it('renders Unknown', () => {
    const html = renderToStaticMarkup(<StatusBadge status="unknown" />);
    expect(html).toContain('Unknown');
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx nx test web -- StatusBadge`
Expected: FAIL — current `StatusBadge` ignores props and always renders "Unknown".

- [ ] **Step 8: Implement the real `StatusBadge`**

Replace `apps/web/src/components/dashboard/StatusBadge.tsx`:

```tsx
import { Badge } from '../ui/badge';

type Props = {
  status: 'online' | 'offline' | 'unknown';
  players?: number;
  maxPlayers?: number;
};

export default function StatusBadge({ status, players, maxPlayers }: Props) {
  if (status === 'online') {
    const hasCounts = players !== undefined && maxPlayers !== undefined;
    return (
      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
        {hasCounts ? `Online · ${players}/${maxPlayers}` : 'Online'}
      </Badge>
    );
  }
  if (status === 'offline') {
    return (
      <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400">
        Offline
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-white/15 bg-white/5 text-white/60">
      Unknown
    </Badge>
  );
}
```

- [ ] **Step 9: Run both test files and confirm they pass**

Run: `npx nx test web -- StatusBadge status-display`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/src/lib/status-display.ts apps/web/src/lib/status-display.test.ts apps/web/src/components/dashboard/StatusBadge.tsx apps/web/src/components/dashboard/StatusBadge.test.tsx
git -c commit.gpgsign=false commit -m "feat(web): add real StatusBadge and staleness display logic"
```

---

## Task 9: Servers page join + install-command UI

**Files:**
- Modify: `apps/web/src/pages/dashboard/servers.astro`
- Create: `apps/web/src/components/dashboard/AgentInstallDialog.tsx`
- Modify: `apps/web/src/components/dashboard/ServerFormDialog.tsx`

UI wiring is build/lint-verified (the logic it depends on — `displayStatus`, `StatusBadge` — is already unit-tested).

- [ ] **Step 1: Left-join `server_status` and apply staleness in `servers.astro`**

Replace the frontmatter + the status cell of `apps/web/src/pages/dashboard/servers.astro`. New frontmatter:

```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, servers, serverStatus, type GameType } from '@voz/shared';
import { displayStatus } from '../../lib/status-display';
import Dashboard from '../../layouts/Dashboard.astro';
import { Card, CardContent } from '../../components/ui/card.tsx';
import StatusBadge from '../../components/dashboard/StatusBadge.tsx';
import ServerFormDialog from '../../components/dashboard/ServerFormDialog.tsx';
import DeleteServerButton from '../../components/dashboard/DeleteServerButton.tsx';
import AgentInstallDialog from '../../components/dashboard/AgentInstallDialog.tsx';

const POLL_INTERVAL_SECONDS = 30;
const db = createDb(env.DB);
const rows = await db
  .select({ server: servers, status: serverStatus })
  .from(servers)
  .leftJoin(serverStatus, eq(serverStatus.serverId, servers.id))
  .all();
const admin = Astro.locals.user?.role === 'admin';
const now = new Date();

const GAME_LABELS: Record<GameType, string> = {
  'minecraft-java': 'Minecraft (Java)',
  'minecraft-bedrock': 'Minecraft (Bedrock)',
  source: 'Source',
  'generic-tcp': 'TCP',
  unknown: 'Unknown',
};
---
```

Then change the empty-state guard and the table body to iterate `rows`. Replace `all.length === 0` with `rows.length === 0`, and replace the `{all.map((s) => (` loop body with:

```astro
            {rows.map(({ server: s, status }) => {
              const display = displayStatus(status, POLL_INTERVAL_SECONDS, now);
              return (
              <tr class="border-t border-[#1a1a2e]">
                <td class="px-4 py-3">
                  <div class="font-medium text-white">{s.name}</div>
                  {s.description && <div class="text-xs text-white/40">{s.description}</div>}
                </td>
                <td class="px-4 py-3 text-white/70">{GAME_LABELS[s.gameType] ?? s.gameType}</td>
                <td class="px-4 py-3 font-mono text-white/70">{s.host}:{s.port}</td>
                <td class="px-4 py-3">
                  <StatusBadge status={display.status} players={display.players} maxPlayers={display.maxPlayers} />
                </td>
                {admin && (
                  <td class="px-4 py-3">
                    <div class="flex justify-end gap-1">
                      <AgentInstallDialog client:load serverId={s.id} serverName={s.name} />
                      <ServerFormDialog
                        client:load
                        server={{ id: s.id, name: s.name, gameType: s.gameType, host: s.host, port: s.port, description: s.description }}
                      />
                      <DeleteServerButton client:load id={s.id} name={s.name} />
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
```

- [ ] **Step 2: Create the install-command dialog**

`apps/web/src/components/dashboard/AgentInstallDialog.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Terminal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';

type Props = { serverId: string; serverName: string; initialToken?: string };

function installCommand(token: string): string {
  return `curl -fsSL ${location.origin}/install-agent.sh | sh -s -- ${token}`;
}

export default function AgentInstallDialog({ serverId, serverName, initialToken }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<string | null>(initialToken ?? null);

  async function regenerate() {
    setPending(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/agent/regenerate`, { method: 'POST' });
      const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; enrollmentToken?: string };
      if (r.ok && r.enrollmentToken) {
        setToken(r.enrollmentToken);
        toast.success('New enrollment token generated.');
      } else {
        toast.error('Could not regenerate token.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={`Install command for ${serverName}`}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
      >
        <Terminal size={16} />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agent install</DialogTitle>
          <DialogDescription>
            Run this on the box hosting {serverName}. The token is shown only once — regenerate if you lose it.
          </DialogDescription>
        </DialogHeader>
        {token ? (
          <pre className="overflow-x-auto rounded-md border border-input bg-black/40 p-3 text-xs text-white/80">
            {installCommand(token)}
          </pre>
        ) : (
          <p className="text-sm text-white/50">
            The token is stored hashed and cannot be shown again. Generate a new one to install.
          </p>
        )}
        <DialogFooter showCloseButton>
          <Button type="button" variant="outline" disabled={pending} onClick={regenerate}>
            {pending ? 'Generating…' : 'Regenerate token'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Surface the returned enrollment token after create in `ServerFormDialog`**

In `apps/web/src/components/dashboard/ServerFormDialog.tsx`, update the success branch of `handleSubmit` so a freshly created server's token is shown before reload. Change the parsed response type and the create branch:

```tsx
      const r = (await res.json().catch(() => ({ ok: false }))) as {
        ok: boolean;
        error?: string;
        enrollmentToken?: string;
      };
      if (r.ok) {
        if (!isEdit && r.enrollmentToken) {
          const command = `curl -fsSL ${location.origin}/install-agent.sh | sh -s -- ${r.enrollmentToken}`;
          await navigator.clipboard?.writeText(command).catch(() => {});
          toast.success('Server created. Install command copied — paste it on the host.', { duration: 8000 });
        } else {
          toast.success(isEdit ? 'Server updated.' : 'Server created.');
        }
        setOpen(false);
        location.reload();
      } else {
        toast.error(r.error ?? 'Could not save server.');
      }
```

- [ ] **Step 4: Lint + build**

Run: `npx nx lint web && npx nx build web`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/dashboard/servers.astro apps/web/src/components/dashboard/AgentInstallDialog.tsx apps/web/src/components/dashboard/ServerFormDialog.tsx
git -c commit.gpgsign=false commit -m "feat(web): join server status on the servers page and surface install command"
```

---

## Task 10: Install script

**Files:**
- Create: `apps/web/public/install-agent.sh`

A static asset (no unit test); verified by a `sh -n` syntax check.

- [ ] **Step 1: Write the install script**

`apps/web/public/install-agent.sh`:

```sh
#!/bin/sh
# voz.gg status-monitor agent installer.
# Usage: curl -fsSL <site>/install-agent.sh | sh -s -- <enrollmentToken>
set -eu

REPO_OWNER="Voziv"
RELEASE_TAG="status-monitor-latest"
INSTALL_PATH="/usr/local/bin/voz-status-monitor"
CONFIG_DIR="/etc/voz-status-monitor"
CONFIG_PATH="${CONFIG_DIR}/config.json"
SERVICE_PATH="/etc/systemd/system/voz-status-monitor.service"

ENROLLMENT_TOKEN="${1:-}"
if [ -z "${ENROLLMENT_TOKEN}" ]; then
  echo "error: enrollment token required" >&2
  echo "usage: curl -fsSL <site>/install-agent.sh | sh -s -- <enrollmentToken>" >&2
  exit 1
fi

# Same origin as the script. Allow override for local testing.
WORKER_BASE_URL="${VOZ_WORKER_BASE_URL:-https://voz.gg}"

case "$(uname -s)" in
  Linux) OS="linux" ;;
  Darwin) OS="darwin" ;;
  *) echo "error: unsupported OS $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) echo "error: unsupported arch $(uname -m)" >&2; exit 1 ;;
esac

BINARY_URL="https://github.com/${REPO_OWNER}/voz.gg/releases/download/${RELEASE_TAG}/status-monitor-${OS}-${ARCH}"

echo "Downloading ${BINARY_URL}"
curl -fsSL "${BINARY_URL}" -o "${INSTALL_PATH}"
chmod +x "${INSTALL_PATH}"

echo "Enrolling agent"
ENROLL_RESPONSE="$(curl -fsSL -X POST "${WORKER_BASE_URL}/api/agents/enroll" \
  -H 'Content-Type: application/json' \
  -d "{\"enrollmentToken\":\"${ENROLLMENT_TOKEN}\"}")"

# The agent re-reads/refreshes config itself; the installer writes the bootstrap file.
mkdir -p "${CONFIG_DIR}"
printf '%s' "${ENROLL_RESPONSE}" | "${INSTALL_PATH}" -write-config \
  -config "${CONFIG_PATH}" \
  -worker-base-url "${WORKER_BASE_URL}"

cat > "${SERVICE_PATH}" <<UNIT
[Unit]
Description=voz.gg status-monitor agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${INSTALL_PATH} -config ${CONFIG_PATH}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable --now voz-status-monitor.service
  echo "voz-status-monitor started"
else
  echo "systemctl not found; binary installed at ${INSTALL_PATH}, run it with -config ${CONFIG_PATH}" >&2
fi
```

> The script pipes the enroll response into `status-monitor -write-config`, which merges `agentToken` + `config` + `configHash` from stdin with `-worker-base-url` and writes `config.json` (implemented in Task 12). This keeps JSON assembly in Go (no `jq` dependency on the host).

- [ ] **Step 2: Syntax-check the script**

Run: `sh -n apps/web/public/install-agent.sh`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/install-agent.sh
git -c commit.gpgsign=false commit -m "feat(web): add status-monitor agent install script"
```

---

## Task 11: `go-shared` — `Post` transport helper

**Files:**
- Modify: `libs/go-shared/report.go`
- Create: `libs/go-shared/report_test.go`

- [ ] **Step 1: Write the failing test**

`libs/go-shared/report_test.go`:

```go
package goshared

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPostSendsBearerAndDecodesResponse(t *testing.T) {
	type reqBody struct {
		Name string `json:"name"`
	}
	type respBody struct {
		Echo string `json:"echo"`
	}

	var gotAuth, gotContentType, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotContentType = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_ = json.NewEncoder(w).Encode(respBody{Echo: "ok"})
	}))
	defer srv.Close()

	r := Reporter{Endpoint: srv.URL, Token: "tok123", Client: srv.Client()}
	var out respBody
	if err := r.Post("/echo", reqBody{Name: "alice"}, &out); err != nil {
		t.Fatalf("Post returned error: %v", err)
	}

	if gotAuth != "Bearer tok123" {
		t.Fatalf("auth header = %q", gotAuth)
	}
	if gotContentType != "application/json" {
		t.Fatalf("content-type = %q", gotContentType)
	}
	if gotBody != `{"name":"alice"}` && gotBody != "{\"name\":\"alice\"}\n" {
		t.Fatalf("body = %q", gotBody)
	}
	if out.Echo != "ok" {
		t.Fatalf("decoded echo = %q", out.Echo)
	}
}

func TestPostNonOKStatusIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	r := Reporter{Endpoint: srv.URL, Token: "bad", Client: srv.Client()}
	if err := r.Post("/x", map[string]string{}, nil); err == nil {
		t.Fatal("expected error on 401, got nil")
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx nx test go-shared`
Expected: FAIL — `r.Post undefined`.

- [ ] **Step 3: Add `Post` (and a `Send` for the existing `Event` flow) to `report.go`**

Append to `libs/go-shared/report.go`:

```go
import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// ... existing Reporter struct + buildRequest above ...

func (r Reporter) httpClient() *http.Client {
	if r.Client != nil {
		return r.Client
	}
	return http.DefaultClient
}

// Send posts a single Event to the configured Endpoint with the bearer token.
func (r Reporter) Send(e Event) error {
	req, err := r.buildRequest(e)
	if err != nil {
		return err
	}
	resp, err := r.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("report: unexpected status %d", resp.StatusCode)
	}
	return nil
}

// Post sends payload as JSON to Endpoint+path with the bearer token and, when
// out is non-nil, decodes the JSON response into it.
func (r Reporter) Post(path string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, r.Endpoint+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+r.Token)

	resp, err := r.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("post %s: status %d: %s", path, resp.StatusCode, string(b))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
```

> The existing file already has an `import (...)` block with `bytes`, `encoding/json`, `net/http`. Merge — do not duplicate the block. The final import set is exactly: `bytes`, `encoding/json`, `fmt`, `io`, `net/http`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx nx test go-shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/go-shared/report.go libs/go-shared/report_test.go
git -c commit.gpgsign=false commit -m "feat(go-shared): add Post and Send transport helpers"
```

---

## Task 12: Agent config load/save + `-write-config`

**Files:**
- Create: `services/status-monitor/config.go`
- Test: `services/status-monitor/config_test.go`

- [ ] **Step 1: Write the failing test**

`services/status-monitor/config_test.go`:

```go
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sampleConfig() Config {
	return Config{
		WorkerBaseURL: "https://voz.gg",
		AgentToken:    "agent-tok",
		ConfigHash:    "abc123",
		Server: ServerConfig{
			ServerID:            "srv1",
			GameType:            "minecraft-java",
			ProbeHost:           "127.0.0.1",
			Port:                25565,
			QueryPort:           0,
			PollIntervalSeconds: 30,
		},
	}
}

func TestSaveThenLoadRoundTrips(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	want := sampleConfig()
	if err := SaveConfig(path, want); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	got, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if got != want {
		t.Fatalf("round-trip mismatch:\n got %+v\nwant %+v", got, want)
	}
}

func TestLoadMissingFileErrors(t *testing.T) {
	if _, err := LoadConfig(filepath.Join(t.TempDir(), "nope.json")); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestConfigFromEnrollMergesBootstrap(t *testing.T) {
	enroll := `{"agentToken":"AT","config":{"serverId":"srv1","gameType":"source","probeHost":"127.0.0.1","port":27015,"queryPort":0,"pollIntervalSeconds":30},"configHash":"H1"}`
	cfg, err := ConfigFromEnroll(strings.NewReader(enroll), "https://voz.gg")
	if err != nil {
		t.Fatalf("ConfigFromEnroll: %v", err)
	}
	if cfg.AgentToken != "AT" || cfg.ConfigHash != "H1" || cfg.WorkerBaseURL != "https://voz.gg" {
		t.Fatalf("bad merge: %+v", cfg)
	}
	if cfg.Server.GameType != "source" || cfg.Server.Port != 27015 {
		t.Fatalf("bad server merge: %+v", cfg.Server)
	}
}

func TestSaveWritesIndentedJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := SaveConfig(path, sampleConfig()); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	raw, _ := os.ReadFile(path)
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		t.Fatalf("written file is not valid JSON: %v", err)
	}
	if _, ok := probe["workerBaseUrl"]; !ok {
		t.Fatalf("expected workerBaseUrl key, got %s", raw)
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx nx test status-monitor`
Expected: FAIL — `Config`, `LoadConfig`, etc. undefined.

- [ ] **Step 3: Implement `config.go`**

`services/status-monitor/config.go`:

```go
package main

import (
	"encoding/json"
	"io"
	"os"
)

// ServerConfig mirrors the Worker's AgentConfig shape. The agent treats the
// surrounding ConfigHash as opaque and never recomputes it.
type ServerConfig struct {
	ServerID            string `json:"serverId"`
	GameType            string `json:"gameType"`
	ProbeHost           string `json:"probeHost"`
	Port                int    `json:"port"`
	QueryPort           int    `json:"queryPort"`
	PollIntervalSeconds int    `json:"pollIntervalSeconds"`
}

type Config struct {
	WorkerBaseURL string       `json:"workerBaseUrl"`
	AgentToken    string       `json:"agentToken"`
	ConfigHash    string       `json:"configHash"`
	Server        ServerConfig `json:"config"`
}

func LoadConfig(path string) (Config, error) {
	var cfg Config
	raw, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func SaveConfig(path string, cfg Config) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

// enrollResponse is the POST /api/agents/enroll response shape.
type enrollResponse struct {
	AgentToken string       `json:"agentToken"`
	Config     ServerConfig `json:"config"`
	ConfigHash string       `json:"configHash"`
}

// ConfigFromEnroll merges an enroll response (read from r) with the worker base
// URL into a Config ready to persist. Used by the `-write-config` bootstrap path.
func ConfigFromEnroll(r io.Reader, workerBaseURL string) (Config, error) {
	var resp enrollResponse
	if err := json.NewDecoder(r).Decode(&resp); err != nil {
		return Config{}, err
	}
	return Config{
		WorkerBaseURL: workerBaseURL,
		AgentToken:    resp.AgentToken,
		ConfigHash:    resp.ConfigHash,
		Server:        resp.Config,
	}, nil
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx nx test status-monitor`
Expected: PASS (the stub `main_test.go` still passes too).

- [ ] **Step 5: Commit**

```bash
git add services/status-monitor/config.go services/status-monitor/config_test.go
git -c commit.gpgsign=false commit -m "feat(status-monitor): add config load/save and enroll bootstrap"
```

---

## Task 13: Prober types + TCP prober

**Files:**
- Create: `services/status-monitor/prober/prober.go`
- Create: `services/status-monitor/prober/tcp.go`
- Test: `services/status-monitor/prober/tcp_test.go`

- [ ] **Step 1: Write the `Status`/`Prober` types**

`services/status-monitor/prober/prober.go`:

```go
// Package prober probes game servers for liveness and player counts.
package prober

import "context"

type Status struct {
	Status     string `json:"status"` // "online" | "offline" | "unknown"
	Players    *int   `json:"players,omitempty"`
	MaxPlayers *int   `json:"maxPlayers,omitempty"`
	Version    string `json:"version,omitempty"`
	LatencyMs  *int   `json:"latencyMs,omitempty"`
}

type Prober interface {
	Probe(ctx context.Context, host string, port, queryPort int) (Status, error)
}

func intPtr(v int) *int { return &v }
```

- [ ] **Step 2: Write the failing TCP test**

`services/status-monitor/prober/tcp_test.go`:

`services/status-monitor/prober/tcp_test.go` (note: `parsePort` is a shared helper for the whole `prober` test package — defined here once and reused by the SLP test):

```go
package prober

import (
	"context"
	"fmt"
	"net"
	"testing"
	"time"
)

func parsePort(t *testing.T, addr string) int {
	t.Helper()
	_, portStr, _ := net.SplitHostPort(addr)
	var port int
	if _, err := fmt.Sscan(portStr, &port); err != nil {
		t.Fatalf("parse port %q: %v", portStr, err)
	}
	return port
}

func TestTCPProberOnlineWhenListening(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()

	port := parsePort(t, ln.Addr().String())
	st, err := TCP{Timeout: time.Second}.Probe(context.Background(), "127.0.0.1", port, 0)
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if st.Status != "online" {
		t.Fatalf("status = %q, want online", st.Status)
	}
	if st.LatencyMs == nil {
		t.Fatal("expected latency to be set")
	}
}

func TestTCPProberOfflineWhenClosed(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := parsePort(t, ln.Addr().String())
	ln.Close() // nothing listening now

	st, err := TCP{Timeout: 200 * time.Millisecond}.Probe(context.Background(), "127.0.0.1", port, 0)
	if err != nil {
		t.Fatalf("Probe returned error (should report offline, not error): %v", err)
	}
	if st.Status != "offline" {
		t.Fatalf("status = %q, want offline", st.Status)
	}
}
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx nx test status-monitor`
Expected: FAIL — `TCP` undefined.

- [ ] **Step 4: Implement `tcp.go`**

`services/status-monitor/prober/tcp.go`:

```go
package prober

import (
	"context"
	"net"
	"strconv"
	"time"
)

// TCP is the universal fallback prober: a successful connect means online.
type TCP struct {
	Timeout time.Duration
}

func (p TCP) Probe(ctx context.Context, host string, port, _ int) (Status, error) {
	timeout := p.Timeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	dialer := net.Dialer{Timeout: timeout}
	start := time.Now()
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return Status{Status: "offline"}, nil
	}
	defer conn.Close()
	latency := int(time.Since(start).Milliseconds())
	return Status{Status: "online", LatencyMs: &latency}, nil
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx nx test status-monitor`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/status-monitor/prober/prober.go services/status-monitor/prober/tcp.go services/status-monitor/prober/tcp_test.go
git -c commit.gpgsign=false commit -m "feat(status-monitor): add prober types and TCP fallback prober"
```

---

## Task 14: SLP (Minecraft Java) prober

**Files:**
- Create: `services/status-monitor/prober/slp.go`
- Test: `services/status-monitor/prober/slp_test.go`

Ported faithfully from `src/lib/status/minecraft.ts`: VarInt handshake (protocol -1, host, port, next-state 1) + status request (0x00), then read the VarInt-framed JSON.

- [ ] **Step 1: Write the failing test (synthesizes a real SLP status response)**

`services/status-monitor/prober/slp_test.go`:

`parsePort` is already defined in `tcp_test.go` (same `prober` package) — do not redefine it here.

```go
package prober

import (
	"context"
	"net"
	"testing"
	"time"
)

// buildStatusResponse frames a status JSON the way a Minecraft server does:
// outer VarInt length, packet id 0x00, VarInt JSON length, JSON bytes.
func buildStatusResponse(json string) []byte {
	var inner []byte
	inner = append(inner, encodeVarInt(0x00)...)
	inner = append(inner, encodeVarInt(len(json))...)
	inner = append(inner, []byte(json)...)
	return append(encodeVarInt(len(inner)), inner...)
}

func TestSLPParsesPlayersAndVersion(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	json := `{"version":{"name":"1.21","protocol":767},"players":{"online":12,"max":50},"description":{"text":"hi"}}`
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		// Drain handshake + status-request, then reply.
		buf := make([]byte, 256)
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		_, _ = conn.Read(buf)
		_, _ = conn.Write(buildStatusResponse(json))
	}()

	port := parsePort(t, ln.Addr().String())
	st, err := SLP{Timeout: 2 * time.Second}.Probe(context.Background(), "127.0.0.1", port, 0)
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if st.Status != "online" {
		t.Fatalf("status = %q, want online", st.Status)
	}
	if st.Players == nil || *st.Players != 12 {
		t.Fatalf("players = %v, want 12", st.Players)
	}
	if st.MaxPlayers == nil || *st.MaxPlayers != 50 {
		t.Fatalf("maxPlayers = %v, want 50", st.MaxPlayers)
	}
	if st.Version != "1.21" {
		t.Fatalf("version = %q, want 1.21", st.Version)
	}
}

func TestSLPOfflineWhenNothingListening(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := parsePort(t, ln.Addr().String())
	ln.Close()

	st, err := SLP{Timeout: 200 * time.Millisecond}.Probe(context.Background(), "127.0.0.1", port, 0)
	if err != nil {
		t.Fatalf("Probe returned error: %v", err)
	}
	if st.Status != "offline" {
		t.Fatalf("status = %q, want offline", st.Status)
	}
}

func TestEncodeDecodeVarIntRoundTrip(t *testing.T) {
	for _, v := range []int{0, 1, 127, 128, 255, 300, 25565, 2097151} {
		b := encodeVarInt(v)
		got, n, err := decodeVarInt(b, 0)
		if err != nil {
			t.Fatalf("decode %d: %v", v, err)
		}
		if got != v || n != len(b) {
			t.Fatalf("round-trip %d: got %d size %d (len %d)", v, got, n, len(b))
		}
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx nx test status-monitor`
Expected: FAIL — `SLP`, `encodeVarInt`, `decodeVarInt` undefined.

- [ ] **Step 3: Implement `slp.go`**

`services/status-monitor/prober/slp.go`:

```go
package prober

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net"
	"strconv"
	"time"
)

// SLP implements the Minecraft Java Server List Ping handshake, ported from the
// source TypeScript implementation in src/lib/status/minecraft.ts.
type SLP struct {
	Timeout time.Duration
}

func encodeVarInt(value int) []byte {
	v := uint32(value)
	var out []byte
	for {
		if v&^0x7f == 0 {
			return append(out, byte(v))
		}
		out = append(out, byte(v&0x7f)|0x80)
		v >>= 7
	}
}

func decodeVarInt(buf []byte, offset int) (value int, size int, err error) {
	var shift uint
	for {
		if offset+size >= len(buf) {
			return 0, 0, errors.New("varint out of bounds")
		}
		b := buf[offset+size]
		size++
		value |= int(b&0x7f) << shift
		if b&0x80 == 0 {
			return value, size, nil
		}
		shift += 7
		if shift >= 32 {
			return 0, 0, errors.New("varint too long")
		}
	}
}

func buildHandshakePacket(host string, port int) []byte {
	var data []byte
	data = append(data, encodeVarInt(0x00)...)      // packet id
	data = append(data, encodeVarInt(-1)...)        // protocol version (-1)
	hostBytes := []byte(host)
	data = append(data, encodeVarInt(len(hostBytes))...)
	data = append(data, hostBytes...)
	portBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(portBuf, uint16(port))
	data = append(data, portBuf...)
	data = append(data, encodeVarInt(1)...) // next state: status
	return append(encodeVarInt(len(data)), data...)
}

func buildStatusRequestPacket() []byte {
	data := encodeVarInt(0x00)
	return append(encodeVarInt(len(data)), data...)
}

type slpResponse struct {
	Players *struct {
		Online *int `json:"online"`
		Max    *int `json:"max"`
	} `json:"players"`
	Version *struct {
		Name string `json:"name"`
	} `json:"version"`
}

func (p SLP) Probe(ctx context.Context, host string, port, _ int) (Status, error) {
	timeout := p.Timeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	dialer := net.Dialer{Timeout: timeout}
	start := time.Now()
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return Status{Status: "offline"}, nil
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	if _, err := conn.Write(buildHandshakePacket(host, port)); err != nil {
		return Status{Status: "offline"}, nil
	}
	if _, err := conn.Write(buildStatusRequestPacket()); err != nil {
		return Status{Status: "offline"}, nil
	}

	jsonBytes, err := readStatusJSON(conn)
	if err != nil {
		return Status{Status: "offline"}, nil
	}

	var parsed slpResponse
	if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
		return Status{Status: "offline"}, nil
	}

	latency := int(time.Since(start).Milliseconds())
	st := Status{Status: "online", LatencyMs: &latency}
	if parsed.Players != nil {
		st.Players = parsed.Players.Online
		st.MaxPlayers = parsed.Players.Max
	}
	if parsed.Version != nil {
		st.Version = parsed.Version.Name
	}
	return st, nil
}

// readStatusJSON reads bytes until a full VarInt-framed status packet is buffered,
// then returns just the JSON payload. Mirrors the incremental parse in the source TS.
func readStatusJSON(conn net.Conn) ([]byte, error) {
	buf := make([]byte, 0, 1024)
	tmp := make([]byte, 1024)
	for {
		// Try to parse what we have.
		if pktLen, pktLenSize, perr := decodeVarInt(buf, 0); perr == nil && len(buf) >= pktLenSize+pktLen {
			off := pktLenSize
			pktID, idSize, err := decodeVarInt(buf, off)
			if err != nil {
				return nil, err
			}
			off += idSize
			if pktID != 0x00 {
				return nil, errors.New("unexpected packet id")
			}
			jsonLen, jsonLenSize, err := decodeVarInt(buf, off)
			if err != nil {
				return nil, err
			}
			off += jsonLenSize
			if len(buf) < off+jsonLen {
				return nil, errors.New("truncated json")
			}
			return buf[off : off+jsonLen], nil
		}
		n, err := conn.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			continue
		}
		if err != nil {
			return nil, err
		}
	}
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx nx test status-monitor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/status-monitor/prober/slp.go services/status-monitor/prober/slp_test.go
git -c commit.gpgsign=false commit -m "feat(status-monitor): add Minecraft SLP prober"
```

---

## Task 15: A2S (Source) prober

**Files:**
- Create: `services/status-monitor/prober/a2s.go`
- Test: `services/status-monitor/prober/a2s_test.go`

`A2S_INFO`: send `0xFF 0xFF 0xFF 0xFF 'T' "Source Engine Query\0"`. The server may reply with `S2C_CHALLENGE` (header byte `0x41`) + a 4-byte challenge — re-send the same query with the challenge appended. The info reply has header byte `0x49`, then `protocol` (byte), `name` (string\0), `map` (string\0), `folder` (string\0), `game` (string\0), `appid` (int16), `players` (byte), `maxPlayers` (byte), ...

- [ ] **Step 1: Write the failing test (fake UDP server, challenge round-trip)**

`services/status-monitor/prober/a2s_test.go`:

```go
package prober

import (
	"context"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

func a2sInfoReply(name, mapName string, players, max byte) []byte {
	out := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0x49} // header + 'I'
	out = append(out, 17)                        // protocol
	out = append(out, []byte(name)...)
	out = append(out, 0)
	out = append(out, []byte(mapName)...)
	out = append(out, 0)
	out = append(out, []byte("folder")...)
	out = append(out, 0)
	out = append(out, []byte("game")...)
	out = append(out, 0)
	appid := make([]byte, 2)
	binary.LittleEndian.PutUint16(appid, 730)
	out = append(out, appid...)
	out = append(out, players, max)
	return out
}

func TestA2SParsesInfoWithChallengeRoundTrip(t *testing.T) {
	addr, _ := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		t.Fatalf("listen udp: %v", err)
	}
	defer conn.Close()

	go func() {
		buf := make([]byte, 1500)
		// First request → respond with a challenge (0x41 + 4 bytes).
		n, from, err := conn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		_ = n
		challenge := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0x41, 0x11, 0x22, 0x33, 0x44}
		conn.WriteToUDP(challenge, from)
		// Second request (with challenge) → respond with the info reply.
		_, from2, err := conn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		conn.WriteToUDP(a2sInfoReply("My CS2 Server", "de_dust2", 7, 24), from2)
	}()

	port := conn.LocalAddr().(*net.UDPAddr).Port
	st, err := A2S{Timeout: 2 * time.Second}.Probe(context.Background(), "127.0.0.1", 0, port)
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if st.Status != "online" {
		t.Fatalf("status = %q, want online", st.Status)
	}
	if st.Players == nil || *st.Players != 7 {
		t.Fatalf("players = %v, want 7", st.Players)
	}
	if st.MaxPlayers == nil || *st.MaxPlayers != 24 {
		t.Fatalf("maxPlayers = %v, want 24", st.MaxPlayers)
	}
}

func TestA2SParsesInfoWithoutChallenge(t *testing.T) {
	addr, _ := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	conn, _ := net.ListenUDP("udp", addr)
	defer conn.Close()

	go func() {
		buf := make([]byte, 1500)
		_, from, err := conn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		conn.WriteToUDP(a2sInfoReply("Valheim", "world", 2, 10), from)
	}()

	port := conn.LocalAddr().(*net.UDPAddr).Port
	st, err := A2S{Timeout: 2 * time.Second}.Probe(context.Background(), "127.0.0.1", 0, port)
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if st.Players == nil || *st.Players != 2 || st.MaxPlayers == nil || *st.MaxPlayers != 10 {
		t.Fatalf("players/max = %v/%v, want 2/10", st.Players, st.MaxPlayers)
	}
}

func TestA2SOfflineWhenNoServer(t *testing.T) {
	addr, _ := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	conn, _ := net.ListenUDP("udp", addr)
	port := conn.LocalAddr().(*net.UDPAddr).Port
	conn.Close() // nothing listening

	st, err := A2S{Timeout: 200 * time.Millisecond}.Probe(context.Background(), "127.0.0.1", 0, port)
	if err != nil {
		t.Fatalf("Probe returned error: %v", err)
	}
	if st.Status != "offline" {
		t.Fatalf("status = %q, want offline", st.Status)
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx nx test status-monitor`
Expected: FAIL — `A2S` undefined.

- [ ] **Step 3: Implement `a2s.go`**

`services/status-monitor/prober/a2s.go`:

```go
package prober

import (
	"bytes"
	"context"
	"errors"
	"net"
	"strconv"
	"time"
)

// A2S implements the Steam/Source A2S_INFO query, handling the optional
// S2C_CHALLENGE (0x41) round-trip. Covers CS2, Valheim, Rust, etc.
type A2S struct {
	Timeout time.Duration
}

var a2sInfoPayload = append(
	[]byte{0xFF, 0xFF, 0xFF, 0xFF, 'T'},
	append([]byte("Source Engine Query"), 0)...,
)

func (p A2S) Probe(ctx context.Context, host string, _ int, queryPort int) (Status, error) {
	timeout := p.Timeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "udp", net.JoinHostPort(host, strconv.Itoa(queryPort)))
	if err != nil {
		return Status{Status: "offline"}, nil
	}
	defer conn.Close()
	deadline := time.Now().Add(timeout)
	_ = conn.SetDeadline(deadline)

	resp, err := a2sExchange(conn, a2sInfoPayload)
	if err != nil {
		return Status{Status: "offline"}, nil
	}

	// Challenge response: 0x41 header → resend with the 4-byte challenge appended.
	if len(resp) >= 9 && resp[4] == 0x41 {
		query := append(append([]byte{}, a2sInfoPayload...), resp[5:9]...)
		resp, err = a2sExchange(conn, query)
		if err != nil {
			return Status{Status: "offline"}, nil
		}
	}

	players, max, version, err := parseA2SInfo(resp)
	if err != nil {
		return Status{Status: "offline"}, nil
	}
	return Status{Status: "online", Players: intPtr(players), MaxPlayers: intPtr(max), Version: version}, nil
}

func a2sExchange(conn net.Conn, payload []byte) ([]byte, error) {
	if _, err := conn.Write(payload); err != nil {
		return nil, err
	}
	buf := make([]byte, 1500)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, err
	}
	return buf[:n], nil
}

// parseA2SInfo reads the S2A_INFO reply (header 0x49): protocol byte, then the
// NUL-terminated name/map/folder/game strings, appid (int16), then players + max bytes.
func parseA2SInfo(resp []byte) (players int, max int, version string, err error) {
	if len(resp) < 6 || resp[4] != 0x49 {
		return 0, 0, "", errors.New("not an A2S info reply")
	}
	pos := 5
	pos++ // protocol byte
	// name, map, folder, game
	for i := 0; i < 4; i++ {
		end := bytes.IndexByte(resp[pos:], 0)
		if end < 0 {
			return 0, 0, "", errors.New("truncated string field")
		}
		pos += end + 1
	}
	if pos+4 > len(resp) {
		return 0, 0, "", errors.New("truncated before counts")
	}
	pos += 2 // appid int16
	players = int(resp[pos])
	max = int(resp[pos+1])
	return players, max, "", nil
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx nx test status-monitor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/status-monitor/prober/a2s.go services/status-monitor/prober/a2s_test.go
git -c commit.gpgsign=false commit -m "feat(status-monitor): add Source A2S prober"
```

---

## Task 16: Prober registry

**Files:**
- Create: `services/status-monitor/prober/registry.go`
- Test: `services/status-monitor/prober/registry_test.go`

- [ ] **Step 1: Write the failing test**

`services/status-monitor/prober/registry_test.go`:

```go
package prober

import "testing"

func TestForMapsGameTypes(t *testing.T) {
	if _, ok := For("minecraft-java").(SLP); !ok {
		t.Fatal("minecraft-java should map to SLP")
	}
	if _, ok := For("source").(A2S); !ok {
		t.Fatal("source should map to A2S")
	}
	for _, g := range []string{"generic-tcp", "unknown", "minecraft-bedrock", "anything-else"} {
		if _, ok := For(g).(TCP); !ok {
			t.Fatalf("%s should fall back to TCP", g)
		}
	}
}

func TestEffectiveQueryPort(t *testing.T) {
	// source default query port is the game port when queryPort is 0.
	if got := EffectiveQueryPort("source", 27015, 0); got != 27015 {
		t.Fatalf("source default query port = %d, want 27015", got)
	}
	// explicit queryPort wins.
	if got := EffectiveQueryPort("source", 27015, 27016); got != 27016 {
		t.Fatalf("explicit query port = %d, want 27016", got)
	}
	// non-source falls back to the game port.
	if got := EffectiveQueryPort("minecraft-java", 25565, 0); got != 25565 {
		t.Fatalf("default query port = %d, want 25565", got)
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx nx test status-monitor`
Expected: FAIL — `For` / `EffectiveQueryPort` undefined.

- [ ] **Step 3: Implement `registry.go`**

`services/status-monitor/prober/registry.go`:

```go
package prober

import "time"

const defaultTimeout = 3 * time.Second

// For returns the prober for a server's gameType. Adding a game is a one-line
// case here plus (optionally) a query-port default in EffectiveQueryPort.
func For(gameType string) Prober {
	switch gameType {
	case "minecraft-java":
		return SLP{Timeout: defaultTimeout}
	case "source":
		return A2S{Timeout: defaultTimeout}
	default:
		return TCP{Timeout: defaultTimeout}
	}
}

// EffectiveQueryPort resolves the UDP query port for a probe. An explicit
// queryPort always wins; otherwise Source falls back to the game port.
func EffectiveQueryPort(gameType string, port, queryPort int) int {
	if queryPort != 0 {
		return queryPort
	}
	return port
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx nx test status-monitor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/status-monitor/prober/registry.go services/status-monitor/prober/registry_test.go
git -c commit.gpgsign=false commit -m "feat(status-monitor): add prober registry"
```

---

## Task 17: Agent report loop

**Files:**
- Create: `services/status-monitor/agent.go`
- Test: `services/status-monitor/agent_test.go`

- [ ] **Step 1: Write the failing test (report loop against an `httptest` server)**

`services/status-monitor/agent_test.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"voz.gg/services/status-monitor/prober"
)

type fakeProber struct{ st prober.Status }

func (f fakeProber) Probe(ctx context.Context, host string, port, queryPort int) (prober.Status, error) {
	return f.st, nil
}

func TestRunCyclePostsStatusAndPullsConfigOnMismatch(t *testing.T) {
	var statusBody map[string]any
	configPulled := false

	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer AT" {
			t.Errorf("auth = %q", got)
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &statusBody)
		_ = json.NewEncoder(w).Encode(map[string]string{"configHash": "NEW"})
	})
	mux.HandleFunc("/api/agents/config", func(w http.ResponseWriter, r *http.Request) {
		configPulled = true
		_ = json.NewEncoder(w).Encode(map[string]any{
			"config": map[string]any{
				"serverId": "srv1", "gameType": "minecraft-java", "probeHost": "127.0.0.1",
				"port": 25566, "queryPort": 0, "pollIntervalSeconds": 30,
			},
			"configHash": "NEW",
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	online := 9
	max := 20
	agent := &Agent{
		Config: Config{
			WorkerBaseURL: srv.URL,
			AgentToken:    "AT",
			ConfigHash:    "OLD",
			Server:        ServerConfig{ServerID: "srv1", GameType: "minecraft-java", ProbeHost: "127.0.0.1", Port: 25565, PollIntervalSeconds: 30},
		},
		Client:      srv.Client(),
		ProberForFn: func(string) prober.Prober { return fakeProber{st: prober.Status{Status: "online", Players: &online, MaxPlayers: &max, Version: "1.21"}} },
	}

	if err := agent.RunCycle(context.Background()); err != nil {
		t.Fatalf("RunCycle: %v", err)
	}

	if statusBody["status"] != "online" {
		t.Fatalf("status posted = %v", statusBody["status"])
	}
	if statusBody["players"].(float64) != 9 || statusBody["maxPlayers"].(float64) != 20 {
		t.Fatalf("counts posted = %v/%v", statusBody["players"], statusBody["maxPlayers"])
	}
	if statusBody["configHash"] != "OLD" {
		t.Fatalf("agent should post its cached hash, got %v", statusBody["configHash"])
	}
	if !configPulled {
		t.Fatal("config should have been pulled on hash mismatch")
	}
	if agent.Config.ConfigHash != "NEW" || agent.Config.Server.Port != 25566 {
		t.Fatalf("agent config not updated: hash=%s port=%d", agent.Config.ConfigHash, agent.Config.Server.Port)
	}
}

func TestRunCycleNoPullWhenHashMatches(t *testing.T) {
	configPulled := false
	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"configHash": "SAME"})
	})
	mux.HandleFunc("/api/agents/config", func(w http.ResponseWriter, r *http.Request) {
		configPulled = true
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	agent := &Agent{
		Config:      Config{WorkerBaseURL: srv.URL, AgentToken: "AT", ConfigHash: "SAME", Server: ServerConfig{ServerID: "srv1", GameType: "generic-tcp", Port: 7777, PollIntervalSeconds: 30}},
		Client:      srv.Client(),
		ProberForFn: func(string) prober.Prober { return fakeProber{st: prober.Status{Status: "offline"}} },
	}
	if err := agent.RunCycle(context.Background()); err != nil {
		t.Fatalf("RunCycle: %v", err)
	}
	if configPulled {
		t.Fatal("config should NOT be pulled when hash matches")
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx nx test status-monitor`
Expected: FAIL — `Agent` undefined.

- [ ] **Step 3: Implement `agent.go`**

`services/status-monitor/agent.go`:

```go
package main

import (
	"context"
	"net/http"

	goshared "voz.gg/libs/go-shared"
	"voz.gg/services/status-monitor/prober"
)

// statusReport is the POST /api/status request body.
type statusReport struct {
	Status     string `json:"status"`
	Players    *int   `json:"players,omitempty"`
	MaxPlayers *int   `json:"maxPlayers,omitempty"`
	Version    string `json:"version,omitempty"`
	LatencyMs  *int   `json:"latencyMs,omitempty"`
	ConfigHash string `json:"configHash"`
}

type statusResponse struct {
	ConfigHash string `json:"configHash"`
}

type configResponse struct {
	Config     ServerConfig `json:"config"`
	ConfigHash string       `json:"configHash"`
}

// Agent runs one probe→report→reconcile cycle per tick.
type Agent struct {
	Config      Config
	Client      *http.Client
	ProberForFn func(gameType string) prober.Prober
	ConfigPath  string // when set, persisted config updates are written here
}

func (a *Agent) reporter() goshared.Reporter {
	return goshared.Reporter{Endpoint: a.Config.WorkerBaseURL, Token: a.Config.AgentToken, Client: a.Client}
}

func (a *Agent) RunCycle(ctx context.Context) error {
	srv := a.Config.Server
	p := a.ProberForFn(srv.GameType)
	queryPort := prober.EffectiveQueryPort(srv.GameType, srv.Port, srv.QueryPort)

	st, err := p.Probe(ctx, srv.ProbeHost, srv.Port, queryPort)
	if err != nil {
		// A prober that errors (rather than reporting offline) still must not drop a report.
		st = prober.Status{Status: "offline"}
	}

	report := statusReport{
		Status:     st.Status,
		Players:    st.Players,
		MaxPlayers: st.MaxPlayers,
		Version:    st.Version,
		LatencyMs:  st.LatencyMs,
		ConfigHash: a.Config.ConfigHash,
	}

	var resp statusResponse
	if err := a.reporter().Post("/api/status", report, &resp); err != nil {
		return err
	}

	if resp.ConfigHash != "" && resp.ConfigHash != a.Config.ConfigHash {
		return a.pullConfig(resp.ConfigHash)
	}
	return nil
}

func (a *Agent) pullConfig(expectedHash string) error {
	req, err := http.NewRequest(http.MethodGet, a.Config.WorkerBaseURL+"/api/agents/config", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.Config.AgentToken)
	client := a.Client
	if client == nil {
		client = http.DefaultClient
	}
	httpResp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer httpResp.Body.Close()

	var fresh configResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&fresh); err != nil {
		return err
	}
	a.Config.Server = fresh.Config
	a.Config.ConfigHash = fresh.ConfigHash
	if a.ConfigPath != "" {
		return SaveConfig(a.ConfigPath, a.Config)
	}
	return nil
}
```

> Add `"encoding/json"` to the import block of `agent.go` (used by `pullConfig`). Final imports: `context`, `encoding/json`, `net/http`, `voz.gg/libs/go-shared`, `voz.gg/services/status-monitor/prober`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx nx test status-monitor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/status-monitor/agent.go services/status-monitor/agent_test.go
git -c commit.gpgsign=false commit -m "feat(status-monitor): add probe-report-reconcile cycle"
```

---

## Task 18: `main.go` — flags + loop (replace the stub)

**Files:**
- Modify: `services/status-monitor/main.go`
- Delete: `services/status-monitor/main_test.go` (its `statusEvent` stub no longer exists)

- [ ] **Step 1: Remove the obsolete stub test**

Run:

```bash
git rm services/status-monitor/main_test.go
```

(`config_test.go` and `agent_test.go` already cover the `main` package.)

- [ ] **Step 2: Replace `main.go`**

`services/status-monitor/main.go`:

```go
// Command status-monitor is the co-located voz.gg agent. It probes the local
// game server and reports status to the Worker, re-pulling config on hash change.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"time"

	"voz.gg/services/status-monitor/prober"
)

func main() {
	configPath := flag.String("config", "/etc/voz-status-monitor/config.json", "path to config.json")
	workerBaseURL := flag.String("worker-base-url", "", "worker base URL (only used with -write-config)")
	writeConfig := flag.Bool("write-config", false, "read an enroll response from stdin and write config.json, then exit")
	flag.Parse()

	if *writeConfig {
		cfg, err := ConfigFromEnroll(os.Stdin, *workerBaseURL)
		if err != nil {
			log.Fatalf("write-config: %v", err)
		}
		if err := SaveConfig(*configPath, cfg); err != nil {
			log.Fatalf("write-config: %v", err)
		}
		return
	}

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("load config %s: %v", *configPath, err)
	}

	agent := &Agent{
		Config:      cfg,
		Client:      &http.Client{Timeout: 10 * time.Second},
		ProberForFn: prober.For,
		ConfigPath:  *configPath,
	}

	run(context.Background(), agent)
}

func run(ctx context.Context, agent *Agent) {
	for {
		if err := agent.RunCycle(ctx); err != nil {
			log.Printf("cycle error (retrying next interval): %v", err)
		}
		interval := agent.Config.Server.PollIntervalSeconds
		if interval <= 0 {
			interval = 30
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(interval) * time.Second):
		}
	}
}
```

- [ ] **Step 3: Build, vet, and test the whole project**

Run: `npx nx build status-monitor && npx nx test status-monitor && npx nx lint status-monitor`
Expected: all pass (binary builds; all prober/config/agent tests green; lint clean).

- [ ] **Step 4: Commit**

```bash
git add services/status-monitor/main.go
git -c commit.gpgsign=false commit -m "feat(status-monitor): wire flags, config load, and poll loop"
```

---

## Task 19: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full TS test + lint + build**

Run:

```bash
npx nx test web
npx nx lint web
npx nx build web
```

Expected: all pass. The new TS tests (`agent-config`, `agent-auth`, `agent-handlers`, `route-protection`, `status-display`, `StatusBadge`) are green.

- [ ] **Step 2: Run the full Go test + lint + build**

Run:

```bash
npx nx test go-shared
npx nx test status-monitor
npx nx lint status-monitor
npx nx build status-monitor
```

Expected: all pass.

- [ ] **Step 3: Confirm the migration applies cleanly on a fresh local DB**

Run:

```bash
cd apps/web && npx wrangler d1 migrations apply voz-gg --local
```

Expected: `0004` is listed as already applied (or applies cleanly), no errors.

- [ ] **Step 4: Runtime smoke (manual, document results in the PR)**

These require a running `wrangler dev` and are not automated. Perform and note outcomes:

1. `npx nx run web:preview` (full Worker + D1 locally).
2. Sign in as an admin → create a server → confirm the create response includes `enrollmentToken` and the install command is copied/surfaced.
3. Hand-cut a local release of the binary or build it (`npx nx build status-monitor`), write a `config.json` by hand (or via `status-monitor -write-config` fed the enroll response), point `workerBaseUrl` at the preview URL, and run the agent against a real Minecraft/Source server or a fake `net.Listen`. Confirm `server_status` upserts and the badge flips to **Online · N/M**.
4. Edit the server's port in the #5 dialog → on the next cycle the returned `configHash` mismatches → confirm the agent pulls `GET /api/agents/config` and rewrites `config.json`.
5. Stop the agent → after ~90s (3× poll) the servers page badge shows **Unknown** (staleness).

- [ ] **Step 5: Final tidy commit (if any uncommitted changes remain)**

```bash
git status
# only if there are staged/unstaged changes:
git add -A && git -c commit.gpgsign=false commit -m "chore: live server status verification pass"
```

---

## Optional split (if executed as two PRs)

- **6a (TS Worker side):** Tasks 1–10 — schema, migration, agent libs, endpoints, enrollment surfacing, real `StatusBadge`, servers-page join, install script. Fully testable without a live agent.
- **6b (Go agent):** Tasks 11–18 — `go-shared` `Post`, agent config/probers/loop/main. Depends on 6a's endpoints + a published binary release.
- Task 19 (final verification) runs after whichever set completes (or once, after both).

Default: ship as one plan; revisit only if review wants the boundary.
