---
date: 2026-05-30
feature: Admin server CRUD (create/edit/delete servers, admin-gated)
status: designed
sub_project: 5 of 6 (port-decomposition-roadmap)
---

# voz.gg — Admin server CRUD

## Context

Sub-project #5 in the port of `game-server-panel` (Next.js) into the `voz.gg`
Astro + Cloudflare monorepo. Builds directly on #4 (data backbone): the
`servers` table, `GameType`, the `/dashboard/servers` read-only page, the
dashboard shell, route protection, and the base-vega UI primitives already
exist. #3 (auth) provides the better-auth **admin plugin**, so
`Astro.locals.user.role` is populated (`'user'` by default, `'admin'` for
admins).

This sub-project lets **admins** create, edit, and delete servers from the
existing servers page. Reads are unchanged. Live status remains #6 — the
`StatusBadge` placeholder is untouched here.

Source surface: `src/app/dashboard/servers/actions.ts` (the `createServer` /
`updateServer` / `deleteServer` server actions, zod-validated, `requireAdmin`-
gated), `src/components/dashboard/{server-form-dialog,delete-server-button}.tsx`,
`src/components/ui/dialog.tsx`, and the admin branches of
`src/app/dashboard/servers/page.tsx`.

## Decisions

- **Admin bootstrap:** manual D1 SQL (`UPDATE user SET role='admin' WHERE …`).
  No user-management UI in #5 — promoting users is a separate concern. The spec
  documents the SQL.
- **Server actions → REST API routes:** the three Next.js server actions become
  Astro API routes (`POST /api/servers`, `PUT /api/servers/:id`,
  `DELETE /api/servers/:id`). Env via `import { env } from 'cloudflare:workers'`.
- **Transport:** JSON request bodies (the island is ours to control; cleaner than
  the source's FormData, which existed only to feed server actions).
- **Validation:** port the source zod schema to `apps/web/src/lib/server-schema.ts`
  (TDD); both write routes use it.
- **Mutation feedback:** on success the islands toast and call `location.reload()`
  to re-render the server-rendered table (same pattern as #4's `SteamLinkCard`).
  No optimistic updates.
- **Delete confirmation:** native `confirm()` (as in the source).

## Goals

- Admins can add a server, edit any field, and delete a server, from
  `/dashboard/servers`.
- Non-admins see the read-only table exactly as in #4 (no controls); the write
  routes reject them with 403.
- All writes are validated; invalid input is rejected with a clear message.

## Non-goals (out of scope)

- **User-management UI / role assignment** — admin promotion is manual D1 SQL.
- **Live server status** (`checkServerStatus`, real `StatusBadge` data) — #6.
- Bulk operations, server ownership transfer, soft-delete/audit history.
- Porting unused shadcn primitives — only `dialog` is added (the form needs it).

## Architecture & components

### A. Dependencies — `apps/web/package.json`

Add `zod` (validation) and `nanoid` (id generation). No other new deps —
`dialog` is built on the already-installed `@base-ui/react`.

### B. Validation — `apps/web/src/lib/server-schema.ts` (TDD)

Port the source zod schema:

```ts
const serverSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  gameType: z.enum(GAME_TYPES),
  host: z.string().trim().min(1, 'Host is required.').max(253)
    .regex(/^[A-Za-z0-9.\-_:]+$/, 'Invalid host.'),
  port: z.coerce.number().int().min(1).max(65535),
  description: z.string().trim().max(500).optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});
```

`GAME_TYPES` is imported from `@voz/shared` (added in #4). The module exports
the schema and a parse helper returning `{ ok: true, data } | { ok: false, error }`
(first zod issue message). Pure/unit-testable.

### C. Admin guard — `apps/web/src/lib/admin.ts`

`isAdmin(user) → user?.role === 'admin'`. The write routes call it and return
`403` when false. Middleware (#3) already redirects unauthenticated users, so
the routes only need the role check (defense-in-depth: they also re-check
`locals.user`).

### D. API routes (REST)

- **`apps/web/src/pages/api/servers/index.ts`** — `POST` create. Admin-gated;
  parse JSON body with the schema; on success insert with `id = nanoid(12)`,
  `createdBy = locals.user.id`, `createdAt/updatedAt = new Date()`; return
  `{ ok: true, id }`.
- **`apps/web/src/pages/api/servers/[id].ts`** — `PUT` update and `DELETE`
  delete. Admin-gated. `PUT`: validate, `update … set {…, updatedAt} where id`;
  if no row matched, return `404`. `DELETE`: `delete where id`; idempotent —
  return `{ ok: true }` even if the row was already gone.
- Both: `export const prerender = false`, env via `cloudflare:workers`,
  `createDb(env.DB)`, drizzle `eq`.

### E. `dialog` primitive — `apps/web/src/components/ui/dialog.tsx`

Port from source with the same import rewrites as #4's primitives
(`@/lib/utils` → relative `cn`, keep `@base-ui/react/*`). Exports `Dialog`,
`DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`,
`DialogTitle`, `DialogDescription` (the names `ServerFormDialog` uses).

### F. Islands — `apps/web/src/components/dashboard/`

- **`ServerFormDialog.tsx`** — create/edit form inside a `Dialog`. Props:
  optional `server` (edit vs create). Fields: name, gameType (`<select>` over
  `GAME_TYPES`), host, port, description. On submit, `fetch` `POST /api/servers`
  (create) or `PUT /api/servers/:id` (edit) with a JSON body; on `ok` →
  `toast.success` + close + `location.reload()`; on error → `toast.error` with
  the server message. **Trigger** is styled directly with
  `buttonVariants` (`<DialogTrigger className={cn(buttonVariants({…}))}>`), per
  the AGENTS.md hydration gotcha — the source already does this correctly.
- **`DeleteServerButton.tsx`** — a `Button` (ghost/icon, `Trash2`) that runs
  `confirm("Delete server \"<name>\"?")`, then `DELETE /api/servers/:id`; on
  `ok` → toast + `location.reload()`.

### G. Servers page — `apps/web/src/pages/dashboard/servers.astro`

Extend the #4 read-only page:

- Compute `const admin = Astro.locals.user?.role === 'admin'`.
- When `admin`: render an **"Add server"** `ServerFormDialog` (with a `Plus`
  trigger) in the header, and a trailing **actions column** with per-row
  **Edit** (`ServerFormDialog server={s}`, `Pencil`) and **Delete**
  (`DeleteServerButton`). Islands mount `client:load`.
- Non-admin output is byte-for-byte the #4 table (no actions column, no header
  button). The empty-state copy gains the admin-only hint
  ("Click \"Add server\" to create one.").

## Data flow

island (`client:load`) → JSON `fetch` → API route → `isAdmin` check (403 else)
→ zod validate (400 else) → drizzle insert/update/delete → `{ ok }` →
island toasts → `location.reload()` → Astro re-renders the table server-side
from D1.

## Error handling

- Non-admin hitting a write route → `403` → island error toast.
- Invalid body → `400` with the first zod issue message → island shows it.
- `PUT` on a missing id → `404`; `DELETE` on a missing id → idempotent `ok`.
- Network/unknown failure → generic error toast.
- Non-admins never see the controls (the routes are still hardened regardless).

## Testing / acceptance

- `nx test web` — the zod schema is TDD'd: valid input; name empty/too-long;
  bad `gameType`; host failing the regex / too long; port < 1, > 65535, and
  non-integer; description trimmed-empty → `null`, present → kept.
- `nx lint web`, `nx build web` pass.
- As an admin (set via D1 SQL): "Add server" creates a row (visible after the
  reload); Edit changes persist; Delete removes the row; toasts fire.
- As a non-admin: no Add/Edit/Delete controls; `POST`/`PUT`/`DELETE` to the
  routes return `403`.
- Invalid input (e.g. port `70000`) is rejected with the zod message.
- Islands hydrate without Base UI hydration-mismatch warnings (dialog trigger
  styled via `buttonVariants`, not a nested `Button`).

## Files (indicative)

| path | action |
|------|--------|
| `apps/web/package.json` | edit — add `zod`, `nanoid` |
| `apps/web/src/lib/server-schema.ts` (+ test) | create — zod schema + parse helper (TDD) |
| `apps/web/src/lib/admin.ts` | create — `isAdmin(user)` |
| `apps/web/src/pages/api/servers/index.ts` | create — `POST` create |
| `apps/web/src/pages/api/servers/[id].ts` | create — `PUT` update / `DELETE` delete |
| `apps/web/src/components/ui/dialog.tsx` | create — base-vega dialog primitive |
| `apps/web/src/components/dashboard/ServerFormDialog.tsx` | create — create/edit island |
| `apps/web/src/components/dashboard/DeleteServerButton.tsx` | create — delete island |
| `apps/web/src/pages/dashboard/servers.astro` | edit — admin controls |

## Admin bootstrap (operational note)

There is no UI to grant admin. Promote a user manually against D1:

```bash
# local
cd apps/web && npx wrangler d1 execute voz-gg --local \
  --command "UPDATE user SET role='admin' WHERE email='you@example.com';"
# production: same with --remote
```

A user-management UI (list users, toggle role via the better-auth admin
plugin's `setRole`) is a candidate for a later sub-project, not #5.

## Sequencing notes

- Depends on #4's `servers` table + `GameType` + dashboard (present) and #3's
  admin plugin `role` (present). No schema or migration changes in #5 — the
  `servers` table is already complete (`created_by` FK, `GameType`, timestamps).
- **#6 (status monitor)** replaces the `StatusBadge` placeholder with live data;
  the actions column and reads here are independent of it.
- The Base UI hydration gotcha is the main UI risk (the new `dialog` triggers);
  the `buttonVariants`-on-trigger pattern handles it.
