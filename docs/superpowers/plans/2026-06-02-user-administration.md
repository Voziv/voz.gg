# User Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-administration page (and a read-only audit page) to the admin dashboard, with a single protected `owner` above `admin`, built on better-auth's access-control so future role tiers are additive.

**Architecture:** A capability layer (better-auth access-control: statements + roles) plus a target-aware guard layer (pure functions) enforced inside our own `/api/admin/users/...` routes. Routes load the target, run guards, write an audit row, then delegate the real mutation to the better-auth admin plugin's server API. Listing is SSR'd via `auth.api.listUsers`; the React island re-queries for search/pagination. Ownership transfer is an atomic two-row swap done directly in Drizzle (the plugin has no `owner` concept).

**Tech Stack:** Astro SSR (`apps/web`), React islands, better-auth 1.6.12 (`admin` plugin + access-control), Drizzle ORM on Cloudflare D1, Vitest.

**PR strategy:** Seven stacked PRs (each branched off the previous), merged bottom-up. Order matters for the expand/contract migration rule (PR1 ships owner-as-admin code; PR7's data migration that promotes an admin to owner must land only after PR1 is deployed — the linear stack guarantees this).

**Testing convention (observed in repo):** Pure logic is unit-tested in `lib/*.test.ts` (e.g. `invite-transitions.test.ts`). DAOs and API routes are NOT integration-tested (no DB/route harness exists). Follow this: put all authorization rules in pure, fully-tested functions; routes/DAOs/UI are wired without new test harnesses.

---

## File structure

| File | Responsibility | PR |
|------|----------------|----|
| `apps/web/src/lib/permissions.ts` | Access-control: statements, `ROLES`, `Role`, `ADMIN_ROLES`, `ac`, `roles` | 1 |
| `apps/web/src/lib/user-admin-guards.ts` | Pure target-aware authz predicates (the heart of the rules) | 1 |
| `apps/web/src/lib/user-admin-guards.test.ts` | Unit tests for every guard rule | 1 |
| `apps/web/src/lib/admin.ts` | `isAdmin` (role ∈ admin roles), new `isOwner` | 1 |
| `apps/web/src/lib/admin.test.ts` | Updated tests incl. owner | 1 |
| `apps/web/src/lib/auth.ts` | Wire `admin({ ac, roles, adminRoles })` | 1 |
| `apps/web/src/lib/auth-client.ts` | Wire `adminClient({ ac, roles })` | 1 |
| `apps/web/src/layouts/Dashboard.astro` | Admin-nav gate uses `isAdmin`; add Users + Audit nav items | 1, 5, 6 |
| `libs/shared/src/schema.ts` | `adminAuditLog` table + `ADMIN_AUDIT_ACTIONS` | 2 |
| `apps/web/src/lib/audit-dao.ts` | `createAuditDao`: `record`, `listRecent` | 2 |
| `apps/web/drizzle/migrations/00XX_*.sql` | Additive: create `admin_audit_log` | 2 |
| `apps/web/src/lib/user-dao.ts` | `createUserDao`: `byId`, `transferOwnership` | 3, 4 |
| `apps/web/src/pages/api/admin/users/[id]/ban.ts` etc. | Guarded mutation routes | 3 |
| `apps/web/src/pages/api/admin/users/[id]/transfer-ownership.ts` | Owner-only transfer route | 4 |
| `apps/web/src/pages/dashboard/admin/users.astro` | SSR users page | 5 |
| `apps/web/src/components/dashboard/UsersTable.tsx` | Users island (list, search, actions) | 5 |
| `apps/web/src/pages/dashboard/admin/audit.astro` | Read-only audit page | 6 |
| `apps/web/drizzle/migrations/00XX_*.sql` | Data: promote earliest admin → owner (idempotent) | 7 |
| `AGENTS.md` | Document owner role + bootstrap | 7 |

---

## PR 1 — Permission foundation

**Branch:** `feat/user-admin-permissions` off `main`. **PR title:** `feat(web): add owner role and access-control permissions`.

This PR is auth/logic only. It makes prod treat `owner` as an admin (the "expand" step) with zero behavior change for existing `user`/`admin` accounts (no user has role `owner` yet).

### Task 1.1: Permissions module

**Files:**
- Create: `apps/web/src/lib/permissions.ts`

- [ ] **Step 1: Write the module**

```ts
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';

export const ROLES = ['user', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

// Roles that may reach the admin section and call admin-plugin endpoints.
export const ADMIN_ROLES = ['admin', 'owner'] as const satisfies readonly Role[];

export const ac = createAccessControl(defaultStatements);

// Capability bundles. NOTE: only `owner` holds `set-role`, so role management is
// owner-only at the capability layer. Future tiers (e.g. server-restart,
// whitelist) are added here as new statements + roles without touching call sites.
export const roles = {
  user: ac.newRole({ user: [], session: [] }),
  admin: ac.newRole({
    user: ['list', 'get', 'ban', 'delete'],
    session: ['list', 'revoke', 'delete'],
  }),
  owner: ac.newRole({
    user: ['create', 'list', 'get', 'set-role', 'ban', 'delete', 'set-password', 'update', 'impersonate'],
    session: ['list', 'revoke', 'delete'],
  }),
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// Normalize a possibly-null DB role into a known Role, defaulting to 'user'.
export function toRole(value: string | null | undefined): Role {
  return isRole(value) ? value : 'user';
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors from `permissions.ts` (pre-existing unrelated errors, if any, ignored).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/permissions.ts
git commit -s -m "feat(web): add access-control roles and permissions module"
```

### Task 1.2: Guard predicates (TDD)

**Files:**
- Test: `apps/web/src/lib/user-admin-guards.test.ts`
- Create: `apps/web/src/lib/user-admin-guards.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { canActOnTarget, canSetRole, canTransferOwnership } from './user-admin-guards';

const ctx = (over: Partial<Parameters<typeof canActOnTarget>[0]> = {}) => ({
  actorRole: 'admin' as const,
  actorId: 'a',
  targetRole: 'user' as const,
  targetId: 't',
  ...over,
});

describe('canActOnTarget', () => {
  it('lets an admin ban a regular user', () => {
    expect(canActOnTarget(ctx(), 'ban').ok).toBe(true);
  });
  it('lets an owner delete an admin', () => {
    expect(canActOnTarget(ctx({ actorRole: 'owner', targetRole: 'admin' }), 'delete').ok).toBe(true);
  });
  it('blocks acting on the owner (locked) for everyone', () => {
    const r = canActOnTarget(ctx({ actorRole: 'owner', targetRole: 'owner', targetId: 'a', actorId: 'a' }), 'ban');
    expect(r.ok).toBe(false);
  });
  it('blocks an admin from acting on another admin', () => {
    const r = canActOnTarget(ctx({ targetRole: 'admin' }), 'delete');
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  it('blocks self-ban and self-delete', () => {
    expect(canActOnTarget(ctx({ targetId: 'a' }), 'ban').ok).toBe(false);
    expect(canActOnTarget(ctx({ targetId: 'a' }), 'delete').ok).toBe(false);
  });
  it('rejects a non-admin actor', () => {
    expect(canActOnTarget(ctx({ actorRole: 'user' }), 'ban').ok).toBe(false);
  });
});

describe('canSetRole', () => {
  it('lets the owner set a user to admin', () => {
    expect(canSetRole(ctx({ actorRole: 'owner' }), 'admin').ok).toBe(true);
  });
  it('forbids a regular admin from setting any role', () => {
    expect(canSetRole(ctx(), 'admin')).toMatchObject({ ok: false, status: 403 });
  });
  it('forbids setting role to owner (transfer-only)', () => {
    expect(canSetRole(ctx({ actorRole: 'owner' }), 'owner').ok).toBe(false);
  });
  it('forbids the owner setting their own role', () => {
    expect(canSetRole(ctx({ actorRole: 'owner', targetId: 'a' }), 'admin').ok).toBe(false);
  });
  it('rejects an unknown role value', () => {
    // @ts-expect-error testing runtime guard
    expect(canSetRole(ctx({ actorRole: 'owner' }), 'superuser').ok).toBe(false);
  });
});

describe('canTransferOwnership', () => {
  it('lets the owner transfer to an admin', () => {
    expect(canTransferOwnership(ctx({ actorRole: 'owner', targetRole: 'admin' })).ok).toBe(true);
  });
  it('lets the owner transfer to a regular user', () => {
    expect(canTransferOwnership(ctx({ actorRole: 'owner', targetRole: 'user' })).ok).toBe(true);
  });
  it('forbids a non-owner from transferring', () => {
    expect(canTransferOwnership(ctx({ actorRole: 'admin', targetRole: 'user' })).ok).toBe(false);
  });
  it('forbids transferring to self', () => {
    expect(canTransferOwnership(ctx({ actorRole: 'owner', targetId: 'a' })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/user-admin-guards.test.ts`
Expected: FAIL — `canActOnTarget` (and siblings) not defined.

- [ ] **Step 3: Write the implementation**

```ts
import { type Role } from './permissions';

export const USER_ADMIN_ACTIONS = ['ban', 'unban', 'set-role', 'delete', 'revoke-sessions'] as const;
export type UserAdminAction = (typeof USER_ADMIN_ACTIONS)[number];

export type GuardContext = {
  actorRole: Role;
  actorId: string;
  targetRole: Role;
  targetId: string;
};

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

const ALLOW: GuardResult = { ok: true };
const deny = (status: number, error: string): GuardResult => ({ ok: false, status, error });

const ADMIN_ROLES: readonly Role[] = ['admin', 'owner'];
const isActorAdmin = (ctx: GuardContext) => ADMIN_ROLES.includes(ctx.actorRole);

// Actions an admin may NOT perform on their own account (would risk lockout).
const SELF_BLOCKED: readonly UserAdminAction[] = ['ban', 'delete', 'set-role'];

export function canActOnTarget(ctx: GuardContext, action: UserAdminAction): GuardResult {
  if (!isActorAdmin(ctx)) return deny(403, 'You do not have permission to manage users.');

  // The owner is locked: no admin action targets the owner. Ownership changes go
  // through canTransferOwnership only.
  if (ctx.targetRole === 'owner') return deny(403, 'The owner account cannot be modified here.');

  if (ctx.actorId === ctx.targetId && SELF_BLOCKED.includes(action)) {
    return deny(403, `You cannot ${action.replace('-', ' ')} your own account.`);
  }

  if (action === 'set-role' && ctx.actorRole !== 'owner') {
    return deny(403, 'Only the owner can change roles.');
  }

  // Regular admins may act only on regular users; acting on another admin (or the
  // owner, handled above) requires the owner.
  if (ctx.actorRole === 'admin' && ctx.targetRole !== 'user') {
    return deny(403, 'Admins can only manage regular users.');
  }

  return ALLOW;
}

export function canSetRole(ctx: GuardContext, newRole: string): GuardResult {
  const base = canActOnTarget(ctx, 'set-role');
  if (!base.ok) return base;
  // 'owner' is reachable only via transfer; 'user'/'admin' are the assignable roles.
  if (newRole !== 'user' && newRole !== 'admin') {
    return deny(400, 'Role must be "user" or "admin".');
  }
  return ALLOW;
}

export function canTransferOwnership(ctx: GuardContext): GuardResult {
  if (ctx.actorRole !== 'owner') return deny(403, 'Only the owner can transfer ownership.');
  if (ctx.actorId === ctx.targetId) return deny(400, 'You already own this.');
  if (ctx.targetRole === 'owner') return deny(409, 'There can only be one owner.');
  return ALLOW;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/user-admin-guards.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/user-admin-guards.ts apps/web/src/lib/user-admin-guards.test.ts
git commit -s -m "feat(web): add user-admin authorization guards"
```

### Task 1.3: Update `isAdmin`, add `isOwner` (TDD)

**Files:**
- Modify: `apps/web/src/lib/admin.ts`
- Modify: `apps/web/src/lib/admin.test.ts`

- [ ] **Step 1: Update the test first**

Replace the contents of `admin.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { isAdmin, isOwner } from './admin';

describe('isAdmin', () => {
  it('is true for role "admin"', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
  });
  it('is true for role "owner"', () => {
    expect(isAdmin({ role: 'owner' })).toBe(true);
  });
  it('is false for a normal user', () => {
    expect(isAdmin({ role: 'user' })).toBe(false);
  });
  it('is false when role is missing/null', () => {
    expect(isAdmin({})).toBe(false);
    expect(isAdmin({ role: null })).toBe(false);
  });
  it('is false for null/undefined', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe('isOwner', () => {
  it('is true only for role "owner"', () => {
    expect(isOwner({ role: 'owner' })).toBe(true);
    expect(isOwner({ role: 'admin' })).toBe(false);
    expect(isOwner(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/admin.test.ts`
Expected: FAIL — `isOwner` not exported; owner case fails.

- [ ] **Step 3: Update the implementation**

Replace `admin.ts` with:

```ts
import { ADMIN_ROLES } from './permissions';

type WithRole = { role?: string | null } | null | undefined;

export function isAdmin(user: WithRole): boolean {
  return !!user?.role && (ADMIN_ROLES as readonly string[]).includes(user.role);
}

export function isOwner(user: WithRole): boolean {
  return user?.role === 'owner';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/admin.ts apps/web/src/lib/admin.test.ts
git commit -s -m "feat(web): treat owner as admin and add isOwner"
```

### Task 1.4: Wire roles into better-auth (server + client)

**Files:**
- Modify: `apps/web/src/lib/auth.ts:50`
- Modify: `apps/web/src/lib/auth-client.ts:6`

- [ ] **Step 1: Server wiring**

In `auth.ts`, add the import near the other plugin imports:

```ts
import { ac, roles } from './permissions';
```

Replace `admin(),` (line 50) with:

```ts
      admin({ ac, roles, adminRoles: ['admin', 'owner'] }),
```

- [ ] **Step 2: Client wiring**

In `auth-client.ts`, replace `adminClient()` with `adminClient({ ac, roles })` and add the import:

```ts
import { ac, roles } from './permissions';
```

Resulting plugins line:

```ts
  plugins: [inferAdditionalFields<Auth>(), magicLinkClient(), adminClient({ ac, roles })],
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/auth.ts apps/web/src/lib/auth-client.ts
git commit -s -m "feat(web): register owner/admin/user roles with better-auth"
```

### Task 1.5: Admin-nav gate uses `isAdmin`

**Files:**
- Modify: `apps/web/src/layouts/Dashboard.astro:15`

- [ ] **Step 1: Replace the inline role check**

Add to the frontmatter imports:

```ts
import { isAdmin } from '../lib/admin';
```

Replace line 15 `const isUserAdmin = user?.role === 'admin';` with:

```ts
const isUserAdmin = isAdmin(user);
```

- [ ] **Step 2: Build the web project to confirm Astro compiles**

Run: `npx nx build web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/layouts/Dashboard.astro
git commit -s -m "feat(web): gate admin nav with isAdmin so owner sees it"
```

### Task 1.6: Verify the whole PR and open it

- [ ] **Step 1: Run the web test + lint targets**

Run: `npx nx test web && npx nx lint web`
Expected: PASS.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin feat/user-admin-permissions
gh pr create --base main --title "feat(web): add owner role and access-control permissions" \
  --body "Adds the access-control permission foundation (owner/admin/user), updates isAdmin to include owner, adds isOwner, wires roles into better-auth, and adds pure user-admin authorization guards. No user holds 'owner' yet; behavior for existing users is unchanged. First of a 7-PR stack."
```

---

## PR 2 — Audit log schema, DAO, migration

**Branch:** `feat/user-admin-audit-schema` off `feat/user-admin-permissions`. **PR title:** `feat(shared): add admin audit log table and dao`.

### Task 2.1: Add the `adminAuditLog` table

**Files:**
- Modify: `libs/shared/src/schema.ts` (append after `inviteRequest`)

- [ ] **Step 1: Append the table and action constants**

```ts
export const ADMIN_AUDIT_ACTIONS = [
  'ban',
  'unban',
  'set-role',
  'delete',
  'revoke-sessions',
  'transfer-ownership',
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

// Immutable history of admin actions. actorId/targetUserId are plain columns (no
// FK cascade) so entries survive deletion of either user — the log must outlive
// the accounts it references.
export const adminAuditLog = sqliteTable('admin_audit_log', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull().$type<AdminAuditAction>(),
  targetUserId: text('target_user_id').notNull(),
  details: text('details'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

- [ ] **Step 2: Typecheck shared**

Run: `npx nx build shared`
Expected: build succeeds (table is auto-exported via `export * from './schema'`).

- [ ] **Step 3: Commit**

```bash
git add libs/shared/src/schema.ts
git commit -s -m "feat(shared): add admin_audit_log table"
```

### Task 2.2: Generate the migration

**Files:**
- Create: `apps/web/drizzle/migrations/00XX_*.sql` (drizzle-kit names it)

- [ ] **Step 1: Generate**

Run: `cd apps/web && npx drizzle-kit generate`
Expected: a new migration file creating `admin_audit_log`. It must be purely additive (CREATE TABLE only). If drizzle-kit emits anything destructive for unrelated tables, discard those hunks — this migration creates exactly one table.

- [ ] **Step 2: Apply locally and verify**

Run: `cd apps/web && npx wrangler d1 migrations apply voz-gg --local`
Expected: applies cleanly. (No assertion tooling; confirm the command reports success.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/drizzle/migrations
git commit -s -m "feat(web): migrate admin_audit_log table"
```

### Task 2.3: Audit DAO

**Files:**
- Create: `apps/web/src/lib/audit-dao.ts`

- [ ] **Step 1: Write the DAO** (mirrors `invite-dao.ts` style)

```ts
import { desc } from 'drizzle-orm';
import { adminAuditLog, type AdminAuditAction, type Db } from '@voz/shared';

export type AdminAuditRow = typeof adminAuditLog.$inferSelect;

export interface RecordAuditInput {
  id: string;
  actorId: string;
  action: AdminAuditAction;
  targetUserId: string;
  details?: Record<string, unknown> | null;
  at: Date;
}

export interface AuditDao {
  record(input: RecordAuditInput): Promise<void>;
  listRecent(limit: number): Promise<AdminAuditRow[]>;
}

export function createAuditDao(db: Db): AuditDao {
  return {
    async record({ id, actorId, action, targetUserId, details, at }) {
      await db.insert(adminAuditLog).values({
        id,
        actorId,
        action,
        targetUserId,
        details: details ? JSON.stringify(details) : null,
        createdAt: at,
      });
    },

    async listRecent(limit) {
      return db.select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(limit).all();
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit, verify, push, open PR**

```bash
git add apps/web/src/lib/audit-dao.ts
git commit -s -m "feat(web): add admin audit dao"
npx nx test web && npx nx lint web
git push -u origin feat/user-admin-audit-schema
gh pr create --base feat/user-admin-permissions --title "feat(shared): add admin audit log table and dao" \
  --body "Adds the additive admin_audit_log table, its migration, and createAuditDao. Stacked on the permissions PR."
```

---

## PR 3 — User-admin mutation routes

**Branch:** `feat/user-admin-routes` off `feat/user-admin-audit-schema`. **PR title:** `feat(web): add user administration api routes`.

All routes: authenticate caller → load target → run the relevant guard → write an audit row → delegate to the better-auth admin server API. The guard layer (PR1) is the only authorization logic; routes are thin wiring (no new tests, per repo convention).

### Task 3.1: User DAO (`byId`)

**Files:**
- Create: `apps/web/src/lib/user-dao.ts`

- [ ] **Step 1: Write the DAO**

```ts
import { eq } from 'drizzle-orm';
import { user, type Db } from '@voz/shared';

export type UserRow = typeof user.$inferSelect;

export interface UserDao {
  byId(id: string): Promise<UserRow | null>;
}

export function createUserDao(db: Db): UserDao {
  return {
    async byId(id) {
      const row = await db.select().from(user).where(eq(user.id, id)).get();
      return row ?? null;
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/user-dao.ts
git commit -s -m "feat(web): add user dao with byId lookup"
```

### Task 3.2: Shared route helper

**Files:**
- Create: `apps/web/src/lib/user-admin-route.ts`

Centralizes the auth + target-load + guard + audit boilerplate so each route file is a few lines.

- [ ] **Step 1: Write the helper**

```ts
import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { isAdmin } from './admin';
import { toRole, type Role } from './permissions';
import { createUserDao, type UserRow } from './user-dao';
import { createAuditDao } from './audit-dao';
import type { AdminAuditAction } from '@voz/shared';
import type { GuardContext, GuardResult } from './user-admin-guards';

export type ResolvedActor = { id: string; role: Role };

export type RouteSetup =
  | { ok: true; actor: ResolvedActor; target: UserRow; ctx: GuardContext; db: ReturnType<typeof createDb> }
  | { ok: false; response: Response };

const json = (body: unknown, status: number) => Response.json(body, { status });

// Authenticate the caller, load the target user, and build the guard context.
export async function setupUserAdminRoute(astro: APIContext): Promise<RouteSetup> {
  const actorUser = astro.locals.user;
  if (!actorUser) return { ok: false, response: json({ ok: false, error: 'Unauthorized.' }, 401) };
  if (!isAdmin(actorUser)) return { ok: false, response: json({ ok: false, error: 'Forbidden.' }, 403) };

  const id = astro.params.id;
  if (!id) return { ok: false, response: json({ ok: false, error: 'Bad request.' }, 400) };

  const db = createDb(env.DB);
  const target = await createUserDao(db).byId(id);
  if (!target) return { ok: false, response: json({ ok: false, error: 'User not found.' }, 404) };

  const actor: ResolvedActor = { id: actorUser.id, role: toRole(actorUser.role) };
  const ctx: GuardContext = {
    actorRole: actor.role,
    actorId: actor.id,
    targetRole: toRole(target.role),
    targetId: target.id,
  };
  return { ok: true, actor, target, ctx, db };
}

export function guardResponse(result: GuardResult): Response | null {
  return result.ok ? null : json({ ok: false, error: result.error }, result.status);
}

// Write an audit row. Recorded before the mutation is delegated (attempt log);
// actorId/targetUserId are plain columns, so the row survives a delete.
export async function recordAudit(
  db: ReturnType<typeof createDb>,
  entry: { actorId: string; action: AdminAuditAction; targetUserId: string; details?: Record<string, unknown> },
): Promise<void> {
  await createAuditDao(db).record({
    id: crypto.randomUUID(),
    actorId: entry.actorId,
    action: entry.action,
    targetUserId: entry.targetUserId,
    details: entry.details ?? null,
    at: new Date(),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/user-admin-route.ts
git commit -s -m "feat(web): add shared user-admin route helper"
```

### Task 3.3: Ban / unban routes

**Files:**
- Create: `apps/web/src/pages/api/admin/users/[id]/ban.ts`
- Create: `apps/web/src/pages/api/admin/users/[id]/unban.ts`

- [ ] **Step 1: `ban.ts`**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAuth } from '../../../../../lib/auth';
import { canActOnTarget } from '../../../../../lib/user-admin-guards';
import { setupUserAdminRoute, guardResponse, recordAudit } from '../../../../../lib/user-admin-route';

export const prerender = false;

export const POST: APIRoute = async (astro) => {
  const setup = await setupUserAdminRoute(astro);
  if (!setup.ok) return setup.response;

  const guard = canActOnTarget(setup.ctx, 'ban');
  const blocked = guardResponse(guard);
  if (blocked) return blocked;

  const raw = (await astro.request.json().catch(() => ({}))) as Record<string, unknown>;
  const reasonInput = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  const reason = reasonInput.length > 0 ? reasonInput.slice(0, 500) : undefined;
  const banExpiresIn = typeof raw.expiresInSeconds === 'number' && raw.expiresInSeconds > 0 ? raw.expiresInSeconds : undefined;

  await recordAudit(setup.db, {
    actorId: setup.actor.id,
    action: 'ban',
    targetUserId: setup.target.id,
    details: { reason: reason ?? null, expiresInSeconds: banExpiresIn ?? null },
  });

  const auth = getAuth(env as Env);
  await auth.api.banUser({
    headers: astro.request.headers,
    body: { userId: setup.target.id, banReason: reason, banExpiresIn },
  });

  return Response.json({ ok: true });
};
```

- [ ] **Step 2: `unban.ts`**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAuth } from '../../../../../lib/auth';
import { canActOnTarget } from '../../../../../lib/user-admin-guards';
import { setupUserAdminRoute, guardResponse, recordAudit } from '../../../../../lib/user-admin-route';

export const prerender = false;

export const POST: APIRoute = async (astro) => {
  const setup = await setupUserAdminRoute(astro);
  if (!setup.ok) return setup.response;

  const guard = canActOnTarget(setup.ctx, 'unban');
  const blocked = guardResponse(guard);
  if (blocked) return blocked;

  await recordAudit(setup.db, { actorId: setup.actor.id, action: 'unban', targetUserId: setup.target.id });

  const auth = getAuth(env as Env);
  await auth.api.unbanUser({ headers: astro.request.headers, body: { userId: setup.target.id } });

  return Response.json({ ok: true });
};
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/web && npx tsc --noEmit` (expect no new errors)

```bash
git add apps/web/src/pages/api/admin/users/[id]/ban.ts apps/web/src/pages/api/admin/users/[id]/unban.ts
git commit -s -m "feat(web): add ban/unban user-admin routes"
```

### Task 3.4: Delete + revoke-sessions routes

**Files:**
- Create: `apps/web/src/pages/api/admin/users/[id]/delete.ts`
- Create: `apps/web/src/pages/api/admin/users/[id]/revoke-sessions.ts`

- [ ] **Step 1: `delete.ts`**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAuth } from '../../../../../lib/auth';
import { canActOnTarget } from '../../../../../lib/user-admin-guards';
import { setupUserAdminRoute, guardResponse, recordAudit } from '../../../../../lib/user-admin-route';

export const prerender = false;

export const POST: APIRoute = async (astro) => {
  const setup = await setupUserAdminRoute(astro);
  if (!setup.ok) return setup.response;

  const guard = canActOnTarget(setup.ctx, 'delete');
  const blocked = guardResponse(guard);
  if (blocked) return blocked;

  await recordAudit(setup.db, {
    actorId: setup.actor.id,
    action: 'delete',
    targetUserId: setup.target.id,
    details: { email: setup.target.email, role: setup.target.role },
  });

  const auth = getAuth(env as Env);
  await auth.api.removeUser({ headers: astro.request.headers, body: { userId: setup.target.id } });

  return Response.json({ ok: true });
};
```

- [ ] **Step 2: `revoke-sessions.ts`**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAuth } from '../../../../../lib/auth';
import { canActOnTarget } from '../../../../../lib/user-admin-guards';
import { setupUserAdminRoute, guardResponse, recordAudit } from '../../../../../lib/user-admin-route';

export const prerender = false;

export const POST: APIRoute = async (astro) => {
  const setup = await setupUserAdminRoute(astro);
  if (!setup.ok) return setup.response;

  const guard = canActOnTarget(setup.ctx, 'revoke-sessions');
  const blocked = guardResponse(guard);
  if (blocked) return blocked;

  await recordAudit(setup.db, { actorId: setup.actor.id, action: 'revoke-sessions', targetUserId: setup.target.id });

  const auth = getAuth(env as Env);
  await auth.api.revokeUserSessions({ headers: astro.request.headers, body: { userId: setup.target.id } });

  return Response.json({ ok: true });
};
```

- [ ] **Step 3: Typecheck + commit**

```bash
git add "apps/web/src/pages/api/admin/users/[id]/delete.ts" "apps/web/src/pages/api/admin/users/[id]/revoke-sessions.ts"
git commit -s -m "feat(web): add delete and revoke-sessions user-admin routes"
```

### Task 3.5: Set-role route

**Files:**
- Create: `apps/web/src/pages/api/admin/users/[id]/set-role.ts`

- [ ] **Step 1: Write the route**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAuth } from '../../../../../lib/auth';
import { canSetRole } from '../../../../../lib/user-admin-guards';
import { setupUserAdminRoute, guardResponse, recordAudit } from '../../../../../lib/user-admin-route';

export const prerender = false;

export const POST: APIRoute = async (astro) => {
  const setup = await setupUserAdminRoute(astro);
  if (!setup.ok) return setup.response;

  const raw = (await astro.request.json().catch(() => ({}))) as Record<string, unknown>;
  const newRole = typeof raw.role === 'string' ? raw.role : '';

  const guard = canSetRole(setup.ctx, newRole);
  const blocked = guardResponse(guard);
  if (blocked) return blocked;

  await recordAudit(setup.db, {
    actorId: setup.actor.id,
    action: 'set-role',
    targetUserId: setup.target.id,
    details: { oldRole: setup.target.role, newRole },
  });

  const auth = getAuth(env as Env);
  await auth.api.setRole({ headers: astro.request.headers, body: { userId: setup.target.id, role: newRole } });

  return Response.json({ ok: true });
};
```

- [ ] **Step 2: Typecheck, verify, push, open PR**

```bash
git add "apps/web/src/pages/api/admin/users/[id]/set-role.ts"
git commit -s -m "feat(web): add set-role user-admin route"
cd apps/web && npx tsc --noEmit && cd ../..
npx nx test web && npx nx lint web && npx nx build web
git push -u origin feat/user-admin-routes
gh pr create --base feat/user-admin-audit-schema --title "feat(web): add user administration api routes" \
  --body "Adds guarded /api/admin/users/[id]/{ban,unban,delete,revoke-sessions,set-role} routes. Each authenticates, runs the PR1 guards, writes an audit row, then delegates to the better-auth admin server API. Stacked on the audit-schema PR."
```

---

## PR 4 — Ownership transfer

**Branch:** `feat/user-admin-transfer` off `feat/user-admin-routes`. **PR title:** `feat(web): add ownership transfer`.

### Task 4.1: Add `transferOwnership` to the user DAO

**Files:**
- Modify: `apps/web/src/lib/user-dao.ts`

- [ ] **Step 1: Extend the interface and implementation**

Add to `UserDao`:

```ts
  transferOwnership(input: { currentOwnerId: string; newOwnerId: string; at: Date }): Promise<void>;
```

Add the import at the top:

```ts
import { eq } from 'drizzle-orm';
import { user, type Db } from '@voz/shared';
```

Add the method inside `createUserDao`'s returned object:

```ts
    async transferOwnership({ currentOwnerId, newOwnerId, at }) {
      // Atomic swap: the current owner becomes an admin and the target becomes the
      // sole owner. db.batch runs both statements in one D1 transaction so the
      // single-owner invariant is never violated mid-flight.
      await db.batch([
        db.update(user).set({ role: 'admin', updatedAt: at }).where(eq(user.id, currentOwnerId)),
        db.update(user).set({ role: 'owner', updatedAt: at }).where(eq(user.id, newOwnerId)),
      ]);
    },
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add apps/web/src/lib/user-dao.ts
git commit -s -m "feat(web): add transferOwnership to user dao"
```

### Task 4.2: Transfer route

**Files:**
- Create: `apps/web/src/pages/api/admin/users/[id]/transfer-ownership.ts`

- [ ] **Step 1: Write the route**

```ts
import type { APIRoute } from 'astro';
import { createUserDao } from '../../../../../lib/user-dao';
import { canTransferOwnership } from '../../../../../lib/user-admin-guards';
import { setupUserAdminRoute, guardResponse, recordAudit } from '../../../../../lib/user-admin-route';

export const prerender = false;

export const POST: APIRoute = async (astro) => {
  const setup = await setupUserAdminRoute(astro);
  if (!setup.ok) return setup.response;

  const guard = canTransferOwnership(setup.ctx);
  const blocked = guardResponse(guard);
  if (blocked) return blocked;

  await recordAudit(setup.db, {
    actorId: setup.actor.id,
    action: 'transfer-ownership',
    targetUserId: setup.target.id,
    details: { newOwnerEmail: setup.target.email },
  });

  await createUserDao(setup.db).transferOwnership({
    currentOwnerId: setup.actor.id,
    newOwnerId: setup.target.id,
    at: new Date(),
  });

  return Response.json({ ok: true });
};
```

- [ ] **Step 2: Typecheck, verify, push, open PR**

```bash
git add "apps/web/src/pages/api/admin/users/[id]/transfer-ownership.ts"
git commit -s -m "feat(web): add ownership transfer route"
cd apps/web && npx tsc --noEmit && cd ../..
npx nx test web && npx nx lint web && npx nx build web
git push -u origin feat/user-admin-transfer
gh pr create --base feat/user-admin-routes --title "feat(web): add ownership transfer" \
  --body "Owner-only ownership transfer: atomic two-row role swap via db.batch, guarded by canTransferOwnership, audited. Stacked on the routes PR."
```

---

## PR 5 — Users admin page + island

**Branch:** `feat/user-admin-page` off `feat/user-admin-transfer`. **PR title:** `feat(web): add user administration dashboard page`.

### Task 5.1: Users island

**Files:**
- Create: `apps/web/src/components/dashboard/UsersTable.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';

export type AdminUserRole = 'user' | 'admin' | 'owner';

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: AdminUserRole;
  banned: boolean;
  banReason: string | null;
  banExpires: number | null;
  minecraftName: string | null;
  steamPersona: string | null;
  createdAt: number;
};

type Props = {
  users: AdminUserRow[];
  actor: { id: string; role: AdminUserRole };
};

const ROLE_STYLES: Record<AdminUserRole, string> = {
  owner: 'bg-primary/15 text-primary',
  admin: 'bg-success/15 text-success',
  user: 'bg-muted text-muted-foreground',
};

async function post(url: string, body?: unknown): Promise<boolean> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const r = (await res.json().catch(() => ({ ok: false, error: 'Request failed.' }))) as {
    ok: boolean;
    error?: string;
  };
  if (!r.ok) toast.error(r.error ?? 'Action failed.');
  return r.ok;
}

// Mirror of the server guards (UX only — the routes are authoritative).
function canManage(actor: Props['actor'], target: AdminUserRow): boolean {
  if (target.role === 'owner') return false;
  if (actor.id === target.id) return false;
  if (actor.role === 'owner') return true;
  return target.role === 'user'; // admins act only on regular users
}

function BanDialog({ user, onDone }: { user: AdminUserRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get('reason') ?? '');
    setPending(true);
    try {
      if (await post(`/api/admin/users/${user.id}/ban`, { reason })) {
        toast.success(`${user.email} banned.`);
        onDone();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={cn(buttonVariants({ variant: 'destructive', size: 'sm' }))}>Ban</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Ban {user.email}</DialogTitle>
            <DialogDescription>Record a reason. The user is signed out immediately.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5 py-4">
            <Label htmlFor={`reason-${user.id}`}>Reason</Label>
            <Input id={`reason-${user.id}`} name="reason" maxLength={500} required />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Banning…' : 'Ban user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ actor, user, reload }: { actor: Props['actor']; user: AdminUserRow; reload: () => void }) {
  const [pending, setPending] = useState(false);

  async function run(action: string, confirmText: string, body?: unknown) {
    if (!confirm(confirmText)) return;
    setPending(true);
    try {
      if (await post(`/api/admin/users/${user.id}/${action}`, body)) {
        toast.success('Done.');
        reload();
      }
    } finally {
      setPending(false);
    }
  }

  if (user.role === 'owner') {
    return <span className="text-xs text-muted-foreground">Owner (locked)</span>;
  }
  if (!canManage(actor, user)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex justify-end gap-2">
      {user.banned ? (
        <Button type="button" size="sm" variant="outline" disabled={pending}
          onClick={() => run('unban', `Unban ${user.email}?`)}>Unban</Button>
      ) : (
        <BanDialog user={user} onDone={reload} />
      )}
      <Button type="button" size="sm" variant="ghost" disabled={pending}
        onClick={() => run('revoke-sessions', `Sign ${user.email} out of all sessions?`)}>Sign out</Button>
      {actor.role === 'owner' && user.role === 'user' && (
        <Button type="button" size="sm" variant="outline" disabled={pending}
          onClick={() => run('set-role', `Make ${user.email} an admin?`, { role: 'admin' })}>Make admin</Button>
      )}
      {actor.role === 'owner' && user.role === 'admin' && (
        <Button type="button" size="sm" variant="outline" disabled={pending}
          onClick={() => run('set-role', `Demote ${user.email} to a regular user?`, { role: 'user' })}>Demote</Button>
      )}
      {actor.role === 'owner' && (
        <Button type="button" size="sm" variant="outline" disabled={pending}
          onClick={() => run('transfer-ownership', `Transfer ownership to ${user.email}? You will become an admin.`)}>Make owner</Button>
      )}
      <Button type="button" size="sm" variant="destructive" disabled={pending}
        onClick={() => run('delete', `Permanently delete ${user.email}? This cannot be undone.`)}>Delete</Button>
    </div>
  );
}

export default function UsersTable({ users, actor }: Props) {
  const [query, setQuery] = useState('');
  const reload = () => location.reload();

  const filtered = query
    ? users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()))
    : users;

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="Search by name or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Linked</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr className="border-t border-border" key={u.id}>
                <td className="px-4 py-3">
                  <div className="text-foreground">{u.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('rounded px-2 py-0.5 text-xs font-medium', ROLE_STYLES[u.role])}>{u.role}</span>
                </td>
                <td className="px-4 py-3">
                  {u.banned ? (
                    <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">banned</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">active</span>
                  )}
                  {u.banned && u.banReason && <div className="mt-1 text-xs text-muted-foreground">{u.banReason}</div>}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {[u.minecraftName && `MC: ${u.minecraftName}`, u.steamPersona && `Steam: ${u.steamPersona}`]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <RowActions actor={actor} user={u} reload={reload} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add apps/web/src/components/dashboard/UsersTable.tsx
git commit -s -m "feat(web): add users admin table island"
```

### Task 5.2: Users page (SSR)

**Files:**
- Create: `apps/web/src/pages/dashboard/admin/users.astro`

- [ ] **Step 1: Write the page**

```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
import { isAdmin } from '../../../lib/admin';
import { toRole } from '../../../lib/permissions';
import { getAuth } from '../../../lib/auth';
import Dashboard from '../../../layouts/Dashboard.astro';
import UsersTable from '../../../components/dashboard/UsersTable.tsx';
import type { AdminUserRow } from '../../../components/dashboard/UsersTable.tsx';

const actorUser = Astro.locals.user;
if (!isAdmin(actorUser)) return Astro.redirect('/dashboard/profile');

const auth = getAuth(env as Env);
const result = await auth.api.listUsers({
  headers: Astro.request.headers,
  query: { limit: 200, offset: 0, sortBy: 'createdAt', sortDirection: 'desc' },
});

const users: AdminUserRow[] = result.users.map((u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: toRole(u.role),
  banned: !!u.banned,
  banReason: u.banReason ?? null,
  banExpires: u.banExpires ? new Date(u.banExpires).getTime() : null,
  minecraftName: (u as { minecraftName?: string | null }).minecraftName ?? null,
  steamPersona: (u as { steamPersona?: string | null }).steamPersona ?? null,
  createdAt: new Date(u.createdAt).getTime(),
}));

const actor = { id: actorUser!.id, role: toRole(actorUser!.role) };
---
<Dashboard>
  <div class="mx-auto max-w-6xl">
    <div class="mb-8">
      <h1 class="text-3xl font-bold tracking-tight">Users</h1>
      <p class="mt-1 text-muted-foreground">Manage accounts, roles, and bans.</p>
    </div>
    <UsersTable client:load users={users} actor={actor} />
  </div>
</Dashboard>
```

NOTE during implementation: confirm the `listUsers` response field is `result.users` and that user objects expose `banned`/`banReason`/`banExpires`/`createdAt`. If the additional profile fields (`minecraftName`, `steamPersona`) are not present on the returned object, the `as` casts above default them to `null` — acceptable for v1.

- [ ] **Step 2: Add the nav item**

In `apps/web/src/layouts/Dashboard.astro`, extend `adminNav`:

```ts
const adminNav = [
  { href: '/dashboard/admin/users', label: 'Users' },
  { href: '/dashboard/admin/invites', label: 'Invite requests' },
];
```

- [ ] **Step 3: Build, verify, push, open PR**

```bash
git add apps/web/src/pages/dashboard/admin/users.astro apps/web/src/layouts/Dashboard.astro
git commit -s -m "feat(web): add user administration page and nav"
npx nx build web && npx nx test web && npx nx lint web
git push -u origin feat/user-admin-page
gh pr create --base feat/user-admin-transfer --title "feat(web): add user administration dashboard page" \
  --body "SSR users page (auth.api.listUsers) + UsersTable island with role-aware row actions (ban/unban/sign-out/role/transfer/delete) wired to the PR3/PR4 routes, plus the Users nav item. Stacked on the transfer PR."
```

---

## PR 6 — Audit log page

**Branch:** `feat/user-admin-audit-page` off `feat/user-admin-page`. **PR title:** `feat(web): add audit log page`.

### Task 6.1: Audit page (SSR, read-only)

**Files:**
- Create: `apps/web/src/pages/dashboard/admin/audit.astro`

- [ ] **Step 1: Write the page**

```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { isAdmin } from '../../../lib/admin';
import { createAuditDao } from '../../../lib/audit-dao';
import Dashboard from '../../../layouts/Dashboard.astro';

if (!isAdmin(Astro.locals.user)) return Astro.redirect('/dashboard/profile');

const db = createDb(env.DB);
const entries = (await createAuditDao(db).listRecent(200)).map((e) => ({
  id: e.id,
  actorId: e.actorId,
  action: e.action,
  targetUserId: e.targetUserId,
  details: e.details,
  createdAt: e.createdAt.getTime(),
}));
---
<Dashboard>
  <div class="mx-auto max-w-5xl">
    <div class="mb-8">
      <h1 class="text-3xl font-bold tracking-tight">Audit log</h1>
      <p class="mt-1 text-muted-foreground">Recent admin actions, newest first.</p>
    </div>
    {entries.length === 0 ? (
      <div class="rounded-lg border border-border bg-card py-12 text-center text-muted-foreground">
        No admin actions recorded yet.
      </div>
    ) : (
      <div class="overflow-hidden rounded-lg border border-border bg-card">
        <table class="w-full text-sm">
          <thead class="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th class="px-4 py-3 font-medium">When</th>
              <th class="px-4 py-3 font-medium">Actor</th>
              <th class="px-4 py-3 font-medium">Action</th>
              <th class="px-4 py-3 font-medium">Target</th>
              <th class="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr class="border-t border-border">
                <td class="px-4 py-3 text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</td>
                <td class="px-4 py-3 font-mono text-xs text-muted-foreground">{e.actorId}</td>
                <td class="px-4 py-3"><span class="rounded bg-muted px-2 py-0.5 text-xs font-medium">{e.action}</span></td>
                <td class="px-4 py-3 font-mono text-xs text-muted-foreground">{e.targetUserId}</td>
                <td class="px-4 py-3 text-xs text-muted-foreground">{e.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
</Dashboard>
```

- [ ] **Step 2: Add the nav item**

In `apps/web/src/layouts/Dashboard.astro`, extend `adminNav`:

```ts
const adminNav = [
  { href: '/dashboard/admin/users', label: 'Users' },
  { href: '/dashboard/admin/invites', label: 'Invite requests' },
  { href: '/dashboard/admin/audit', label: 'Audit log' },
];
```

- [ ] **Step 3: Build, verify, push, open PR**

```bash
git add apps/web/src/pages/dashboard/admin/audit.astro apps/web/src/layouts/Dashboard.astro
git commit -s -m "feat(web): add read-only audit log page and nav"
npx nx build web && npx nx test web && npx nx lint web
git push -u origin feat/user-admin-audit-page
gh pr create --base feat/user-admin-page --title "feat(web): add audit log page" \
  --body "Read-only audit log page listing recent admin actions via createAuditDao, plus the Audit log nav item. Stacked on the users-page PR."
```

---

## PR 7 — Owner bootstrap migration + docs

**Branch:** `feat/user-admin-owner-bootstrap` off `feat/user-admin-audit-page`. **PR title:** `feat(web): promote existing admin to owner`.

This PR ships the data migration that promotes one existing admin to `owner`. It is last in the stack so that the owner-as-admin code (PR1) is already deployed before any user's role becomes `owner` — satisfying the expand/contract rule (migrations run before code on each deploy, so promoting to a role the live code didn't understand would briefly drop that user's admin access).

### Task 7.1: Owner-promotion migration

**Files:**
- Create: `apps/web/drizzle/migrations/00XX_promote_owner.sql` (custom migration)

- [ ] **Step 1: Create a custom migration**

Run: `cd apps/web && npx drizzle-kit generate --custom --name promote_owner`
Expected: an empty migration file is created and registered in the drizzle journal.

- [ ] **Step 2: Fill it with the idempotent promotion**

```sql
-- Promote the earliest-created admin to owner, but only if no owner exists yet.
-- Idempotent and a no-op on a fresh install with no admins (owner is then set
-- manually via SQL, like the first admin).
UPDATE "user"
SET "role" = 'owner'
WHERE "id" = (
  SELECT "id" FROM "user" WHERE "role" = 'admin' ORDER BY "created_at" ASC LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM "user" WHERE "role" = 'owner');
```

- [ ] **Step 3: Apply locally and confirm no error**

Run: `cd apps/web && npx wrangler d1 migrations apply voz-gg --local`
Expected: applies cleanly.

- [ ] **Step 4: Commit**

```bash
git add apps/web/drizzle/migrations
git commit -s -m "feat(web): promote earliest admin to owner via migration"
```

### Task 7.2: Document the owner role

**Files:**
- Modify: `AGENTS.md` (under the Cloudflare / data section)

- [ ] **Step 1: Add a subsection**

Append after the "Schema migrations" subsection:

```markdown
### Roles & the owner

User roles are `user`, `admin`, and a single `owner` (better-auth access-control;
see `apps/web/src/lib/permissions.ts`). The `owner` is a super-admin that no other
admin can ban/delete/demote; only the owner can change roles and transfer
ownership. A migration promotes the earliest-created `admin` to `owner` on
existing installs. On a **fresh install** with no admins, promote the first
account manually, then set the owner:

\`\`\`sh
npx wrangler d1 execute voz-gg --remote --command \
  "UPDATE \"user\" SET role='owner' WHERE email='you@example.com'"
\`\`\`
```

- [ ] **Step 2: Commit, push, open PR**

```bash
git add AGENTS.md
git commit -s -m "docs: document owner role and bootstrap"
git push -u origin feat/user-admin-owner-bootstrap
gh pr create --base feat/user-admin-audit-page --title "feat(web): promote existing admin to owner" \
  --body "Idempotent data migration promoting the earliest admin to owner (no-op on fresh installs), plus AGENTS.md docs. Last in the stack — must merge/deploy after PR1's owner-as-admin code is live. Reviewer: merge bottom-up (PR1→PR7)."
```

---

## Post-merge verification (after the stack lands on main)

- [ ] Apply migrations to prod: `npx nx run web:migrate` (or it runs automatically on deploy).
- [ ] As the owner, load `/dashboard/admin/users`: confirm the owner row shows "Owner (locked)" with no actions, admins can ban/delete only `user` rows, and role/transfer controls appear only for the owner.
- [ ] Trigger one ban and confirm a row appears on `/dashboard/admin/audit`.

---

## Self-review notes (author)

- **Spec coverage:** roles/permissions (PR1), guardrails incl. self-target/owner-lock/only-owner-manages-admins/confirm+typed-ban-reason (PR1 guards + PR5 UI), audit table + separate read-only page (PR2/PR6), ownership transfer (PR4), migration + bootstrap (PR2/PR7). All spec sections map to a task.
- **Deviation from spec (noted):** `adminAuditLog.actorId` is a plain text column, NOT a FK to `user.id`, so the audit history survives deletion of the actor or target. The spec table listed actorId as "text → user.id"; this plan intentionally drops the FK for log immutability.
- **Verify-during-implementation (from spec risks):** exact `listUsers` response shape and field availability (PR5 Task 5.2 note); `db.batch` transactional semantics for the transfer (PR4). The access-control statement names are confirmed against better-auth 1.6.12 (`set-role`, `ban`, `delete`, `list`, `get`, session `list`/`revoke`/`delete`).
