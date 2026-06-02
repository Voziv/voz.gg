# User Administration — Design

**Date:** 2026-06-02
**Status:** Approved (pending spec review)
**Scope:** Add a user-administration page to the admin dashboard section of `apps/web`, built on a forward-compatible permission foundation.

## Goal

Give admins a page under `/dashboard/admin/` to view all users and act on them
(ban/unban, change role, delete, revoke sessions), with a single protected
`owner` above `admin`. Lay a capability-based permission foundation now so future
role tiers (e.g. a "trusted" user who can restart servers, a "whitelist
moderator") are additive role/statement definitions rather than a refactor of
every authorization call site.

Non-goals for v1: server/whitelist permission statements (those features do not
exist in the repo yet), impersonation, admin-initiated account creation,
editing arbitrary profile fields.

## Background (current state)

- Admin pages live at `apps/web/src/pages/dashboard/admin/` — currently only
  `invites.astro`. Pattern: server-rendered `.astro` fetches data in
  frontmatter via a DAO, gates with `isAdmin(Astro.locals.user)`, renders a
  React island; mutations POST to `/api/.../[id]/<action>.ts` routes that
  re-check `isAdmin`.
- `isAdmin()` (`apps/web/src/lib/admin.ts`) is just `user?.role === 'admin'`.
- Auth is `better-auth` (`apps/web/src/lib/auth.ts`) with the **`admin()`
  plugin already enabled** server-side, and `adminClient()` already enabled
  client-side (`apps/web/src/lib/auth-client.ts`). Sessions are attached to
  `Astro.locals.user` / `Astro.locals.session` in `middleware.ts`.
- The `user` table (`libs/shared/src/schema.ts`) already has `role`
  (default `'user'`), `banned`, `banReason`, `banExpires`, plus profile/link
  fields (`displayName`, `bio`, `minecraftUuid`/`Name`, `steamId64`/`Persona`/
  `Avatar`), `createdAt`, `image`, `email`, `emailVerified`. Related tables:
  `session`, `account` (both cascade-delete on `user.id`).
- No automated first-admin bootstrap exists; the first admin is promoted
  manually via SQL.
- UI components available under `apps/web/src/components/ui/`: `button`,
  `dialog`, `badge`, `card`, `input`, `label`, `sonner` (toasts).

## Role model

Three roles stored in the existing `user.role` text column.

| Role | Reaches admin section | Act on `user` targets (ban/delete/revoke) | Act on `admin` targets | Manage roles (`set-role`) | Protected from others |
|------|:--:|:--:|:--:|:--:|:--:|
| `owner` | yes | yes | yes | yes (only role that can) | yes — locked, untouchable via UI |
| `admin` | yes | yes | no | no | from peer admins, not from owner |
| `user`  | no  | no  | no | no | no |

Invariants:

- **Exactly one `owner`.** Enforced on every role write.
- **Admins act only on `user`-role targets.** Banning/deleting/revoking another
  admin or the owner requires the owner. (Decision: admins cannot neutralize
  each other.)
- **Only the owner changes roles** (holds the `set-role` capability).
- **The owner is locked**: no ban/delete/demote of the owner through the UI; the
  only way the `owner` role moves is the explicit ownership-transfer flow.

## Architecture

### Permission foundation (capability-based)

New shared module `apps/web/src/lib/permissions.ts`, imported by **both**
`auth.ts` (server) and `auth-client.ts` (client) so the role/statement
definitions stay in one place:

```ts
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';

export const ac = createAccessControl({ ...defaultStatements });
// defaultStatements ≈ { user: ['create','list','set-role','ban','impersonate','delete','set-password'],
//                       session: ['list','revoke','delete'] }

export const roles = {
  user:  ac.newRole({}),                                    // no admin capabilities
  admin: ac.newRole({ user: ['list', 'ban', 'delete'],      // NOTE: no 'set-role'
                      session: ['list', 'revoke', 'delete'] }),
  owner: ac.newRole({ ...adminAc.statements }),             // everything, incl. 'set-role'
};

export const adminRoles = ['admin', 'owner'] as const;
```

Wiring:

- `auth.ts`: `admin({ ac, roles, adminRoles: ['admin', 'owner'] })`.
- `auth-client.ts`: `adminClient({ ac, roles })`.
- `lib/admin.ts`: `isAdmin()` becomes "role ∈ adminRoles" (owner counts as
  admin for page-gating); add `isOwner(user)`.

"Only owner manages admins" falls out of the capability layer: only `owner`
holds `set-role`.

### Two authorization layers

1. **Capability layer** — answers "can this actor perform action X on
   resource-type Y *at all*?" Replaces hardcoded role booleans with
   `auth.api.userHasPermission(...)`. Used for the coarse gate.
2. **Target-aware guard layer** — invariants that depend on the *specific
   target* and cannot be expressed as a plain capability. Enforced in the
   mutation routes (see below): owner is locked, self-target blocked,
   admins-act-only-on-users, single-owner invariant, last-owner protection.

### Listing (SSR + client re-query)

`users.astro` fetches the first page server-side via
`auth.api.listUsers({ headers, query: { limit, offset, searchValue, sortBy } })`
and renders the `UsersTable` island with that initial data. The island
re-queries `authClient.admin.listUsers(...)` for search and pagination (reads
are safe to do client-side; the plugin enforces admin authz on the endpoint).

### Mutations (guarded routes, plugin engine)

The island calls **our own** routes (not `authClient.admin.*` directly) so the
target-aware guards cannot be bypassed:

- `POST /api/admin/users/[id]/ban` (body: `reason`, optional `expiresIn`)
- `POST /api/admin/users/[id]/unban`
- `POST /api/admin/users/[id]/set-role` (body: `role`) — owner-only; cannot set
  `owner` here (transfer flow only)
- `POST /api/admin/users/[id]/delete`
- `POST /api/admin/users/[id]/revoke-sessions`
- `POST /api/admin/users/[id]/transfer-ownership` — owner-only

Each route:

1. Resolve caller from session (`auth.api.getSession`); 403 if not an admin role.
2. Load target user.
3. Run guards (capability check + target-aware invariants below). On failure,
   return the appropriate 4xx with a message the UI can toast.
4. Write an audit row.
5. Delegate the real mutation to the plugin's server API
   (`auth.api.banUser` / `unbanUser` / `setRole` / `removeUser` /
   `revokeUserSessions`) so the plugin handles ban-expiry, session revocation,
   and cascade deletes. (Ownership transfer is the exception — see below.)

The guard predicates live in pure, unit-testable functions (e.g. in
`lib/permissions.ts` or a sibling `lib/user-admin-guards.ts`):

- `canActOnTarget(actor, target, action)` — encodes self-target block,
  admins-only-on-users, owner-locked.
- `assertSingleOwnerInvariant(...)`, `assertNotLastOwner(...)`.

## Ownership transfer

Owner-only, high-stakes, behind a confirmation step. Route
`/api/admin/users/[id]/transfer-ownership` performs, in a single D1
transaction: demote the current owner → `admin`, promote the target → `owner`.
Because the plugin has no concept of `owner`-uniqueness, this is done directly
via Drizzle (`db.batch` / transaction) rather than two `setRole` calls, to keep
the single-owner invariant atomic. Audited as `transfer-ownership`.

## Audit log

New table `adminAuditLog` in `libs/shared/src/schema.ts`:

| column | type | notes |
|--------|------|-------|
| `id` | text PK | |
| `actorId` | text → `user.id` | the admin who performed the action |
| `action` | text | `ban` \| `unban` \| `set-role` \| `delete` \| `revoke-sessions` \| `transfer-ownership` |
| `targetUserId` | text | not an FK with cascade — must survive target deletion (store id even if the user row is gone) |
| `details` | text (JSON) | e.g. `{ reason, oldRole, newRole, expiresAt }` |
| `createdAt` | integer timestamp | |

- A `createAuditDao(db)` (mirroring `createInviteDao`) with `record(entry)` and
  `listRecent(limit)`.
- Every mutation route writes one row. Best-effort ordering: write audit before
  delegating the mutation, except `delete` where the target row's existence is
  irrelevant to the audit row (target id is a plain column, not an FK cascade).
- v1 surfaces a **separate read-only audit page** at
  `apps/web/src/pages/dashboard/admin/audit.astro` (gated by `isAdmin`),
  listing recent entries (actor, action, target, details, when), newest first,
  paginated. No editing. A "Audit log" nav item is added to the admin section
  in `Dashboard.astro` alongside "Users" and "Invite requests".

## UI

- `apps/web/src/pages/dashboard/admin/users.astro` — gated by `isAdmin`,
  SSR first page, renders island.
- `apps/web/src/components/dashboard/UsersTable.tsx` — mirrors
  `InviteRequestsTable.tsx` structure and styling.
  - Columns: user (name/email/avatar), role badge (distinct owner badge),
    status (active / banned + expiry), linked accounts (Discord/Steam/MC
    indicators), joined date, actions.
  - Row actions are gated by caller role and target role:
    - owner row → no action buttons (locked) for everyone, including other
      admins; the owner viewing their own row sees only "transfer ownership".
    - admin viewing a `user` row → ban/unban, delete, revoke sessions.
    - admin viewing another admin row → no actions.
    - owner → all actions on admins/users, plus role controls and transfer.
  - Destructive actions use a confirmation dialog; **ban requires a typed
    reason**. Toasts via `sonner`.
  - Search box + pagination wired to `authClient.admin.listUsers`.
- Add a "Users" nav item to the admin section in
  `apps/web/src/layouts/Dashboard.astro` (alongside "Invite requests").

The UI gating is a UX convenience only — every restriction is independently
enforced server-side in the routes.

## Migration & bootstrap

- Additive Drizzle migration (generated via `drizzle-kit`): create
  `admin_audit_log`. Migrations are additive only (backward-compatible per
  AGENTS.md expand/contract rules) — no destructive changes.
- **Owner bootstrap on existing installs:** a data step promotes one existing
  `admin` → `owner` (no-op if there are no admins). This can be a one-off SQL
  statement run alongside the migration, documented in AGENTS.md.
- **New installations:** no admins exist, so the bootstrap is a no-op; the owner
  is set manually via SQL, identical to how the first admin is bootstrapped
  today. Documented in AGENTS.md.

## Testing

- Vitest unit tests for the guard predicates (pure functions), mirroring
  `apps/web/src/lib/admin.test.ts`:
  - self-target blocked (ban/delete/demote self).
  - admins act only on `user` targets; acting on admin/owner → denied.
  - owner is locked (every action on an owner target → denied).
  - only owner holds `set-role`; admin role-change → denied.
  - single-owner invariant: `set-role` cannot create a second owner.
  - last-owner protection: owner cannot be demoted/deleted outside transfer.
- `isOwner` / updated `isAdmin` unit tests.
- Route-level tests covering the authorization decisions (caller role × target
  role × action → allowed/denied), with the plugin delegate mocked.

## Open questions / risks

- `better-auth` access-control statement names must match the installed
  version's `defaultStatements`; verify exact action names during implementation
  (`user: ['set-role' | 'set-password' | ...]`).
- `auth.api.listUsers` query/sort/search parameter shape must be confirmed
  against the installed plugin version before wiring SSR + client pagination.
- D1 transactional guarantees for the ownership-transfer swap — confirm
  `db.batch` semantics are sufficient for atomic two-row role swap.
