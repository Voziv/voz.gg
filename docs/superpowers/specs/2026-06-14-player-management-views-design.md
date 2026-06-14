# Player management & views (#25b)

**Date:** 2026-06-14
**Status:** Approved (design); pending spec review
**Roadmap:** sub-project #7 "player presence & playtime", split into #25a (presence & identity foundation, merged in PR #51), #25b (this), #25c (notifications).

## Problem

#25a landed the data foundation: the `presence_events` log, the `player` /
`player_identity` tables, read-time session/playtime derivation, and a bare
`/dashboard/players` list. #25b builds the **operator-facing layer**: rich
player and per-server views, the management actions (rename, notes, status,
freeform groups, manual identity add, merge), and the read-through linked-account
panel. It also relaxes the players list from admin-only to any logged-in user.

Out of scope (later): Discord-webhook notifications and their rules (#25c). The
Go `voz-gg-agent logparse` producer is still #25a PR-2 (blocked on the
agent-host-provisioning Go restructure); #25b is verified against synthetic D1
data and is independent of it.

## Scope

In:

- A new **status** model on players (`new` / `allowed` / `blocked`), defaulting
  to `new`, plus an **informational** `isBot` flag.
- Freeform **groups** (`group_tag` + `player_group_tag` join), managed inline.
- A **sessions** table on player views (derived at read time; no timeline graph).
- A **player detail** view (`/dashboard/players/<id>`), a **per-server players**
  view (`/dashboard/servers/<id>/players`), and a scoped player drill-in
  (`?server=<id>`).
- Visibility tiering: any logged-in user sees the views; **admin/owner** see and
  edit the management surfaces.
- Read-through **linked-account** panel and **manual identity add**.
- A **merge** UI to combine two players.
- Admin-only **IP** surfacing (IPs-seen list + per-session IP column).

Out:

- Notifications (#25c).
- The Go log producer (#25a PR-2). The join-line IP capture the IP columns rely
  on is a PR-2 parser addition; until then IP fields render empty.
- IP retention / purge policy (deferred to #25c alongside notification rules).

## Data model (`libs/shared/src/schema.ts`)

Additive only → backward-compatible, single deploy. Migration generated with
`cd apps/web && npx drizzle-kit generate`; artifacts in
`apps/web/drizzle/migrations`.

```ts
export const PLAYER_STATUSES = ['new', 'allowed', 'blocked'] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

// added to the existing `player` table:
//   status:  text('status').notNull().$type<PlayerStatus>().default('new')
//   isBot:   integer('is_bot', { mode: 'boolean' }).notNull().default(false)

// freeform, operator-defined tags (table named group_tag — `group` is a SQLite
// reserved word).
export const groupTag = sqliteTable('group_tag', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [uniqueIndex('group_tag_name_unq').on(table.name)]);

// many-to-many player ↔ group_tag.
export const playerGroupTag = sqliteTable('player_group_tag', {
  playerId: text('player_id').notNull()
    .references(() => player.id, { onDelete: 'cascade' }),
  groupTagId: text('group_tag_id').notNull()
    .references(() => groupTag.id, { onDelete: 'cascade' }),
}, (table) => [primaryKey({ columns: [table.playerId, table.groupTagId] })]);
```

`status` defaults to `new`: a player auto-created from a first sighting (join or
connection-rejection) starts `new`. `isBot` is informational only here — it
demotes the player visually and (in #25c) flips a notification rule, but it does
**not** gate sessions or views. Group names are unique and case-insensitively
matched on add (normalize before lookup so "WTK" and "wtk" don't both exist).

## Views & routes

### `/dashboard/players` (relaxed gate)

Any logged-in user. Enriched from the #25a bare list:

- Display name with the latest Minecraft name as a **pill**; group pills.
- Servers-seen count, last seen, total playtime.
- **Admin/owner only:** status badge, bot marker, filters (status, group).

The nav link moves out of `adminNav` into the authenticated `nav` (Dashboard.astro).

### `/dashboard/players/<id>` — player detail

- **Everyone:** display name + identity pills, groups, servers-seen with
  per-server last-seen + playtime, and the **sessions** table (start, end,
  duration, server).
- **Admin/owner:** editable display name, status control, isBot toggle, notes
  editor, group add/remove, manual identity add, the **merge** entry point, the
  **IPs-seen** list, the **connection-attempts** list, and a per-session **IP**
  column on the sessions table.
- **Linked account panel:** when `player.userId` is set, read through to the
  account (name, avatar, Minecraft/Steam identities) — display only, no editing
  of the account from here.

`?server=<id>` scopes every derived figure (sessions, last-seen, playtime,
IPs) to that one server, for the per-server drill-in.

### `/dashboard/servers/<id>/players` — per-server players

Same experience as the global list, filtered to players seen on that server,
showing per-server last-seen + playtime. Clicking a player drills into
`/dashboard/players/<id>?server=<id>`.

## Management, merge & API

Mutations live under `apps/web/src/pages/api/players/...`, all **admin-gated**
(401 unauthenticated, 403 non-admin). Pure combine/assembly logic lives in
`libs/shared` and is fake-DAO tested; the route handlers are thin wiring.

- `PATCH /api/players/<id>` — display name, status, isBot, notes.
- `POST` / `DELETE /api/players/<id>/groups` — add (create-or-attach by
  normalized name) / detach a group.
- `POST` / `DELETE /api/players/<id>/identities` — manually add / remove an
  identity (`kind` + `identityKey`); 409 on a key already owned by another
  player.
- `POST /api/players/<id>/merge` — merge another player into this one.
- `GET /api/players/search?q=` — typeahead for the merge picker and group
  combobox.

### Merge semantics

Survivor = the player whose page initiated the merge. The other player is
absorbed:

- Re-point its `player_identity` rows to the survivor. `presence_events` join to
  a player only *through* `player_identity` (by `kind` + `identityKey`), so they
  re-home automatically — no separate event re-point.
- Union group memberships.
- `isBot` = OR of the two.
- Append the absorbed notes to the survivor's notes (don't overwrite).
- Account link: if only one side has a `userId`, the survivor carries it; **if
  both sides have a (different) `userId`, reject with 409** — the operator must
  resolve the account conflict first. Same `userId` on both is a no-op.
- Delete the absorbed `player` row after re-pointing.

## Components

React islands (Base UI, base-vega), following the existing dashboard component
patterns (`UsersTable`, `ServerFormDialog`, `DeleteServerButton`). New:

- **`PlayerFieldsEditor`** — display name / status / isBot / notes (admin).
- **`PlayerGroupsEditor`** — inline group combobox (add-or-create, remove).
- **`PlayerIdentitiesEditor`** — manual identity add / remove.
- **`MergePlayerDialog`** — search picker + confirm, surfaces the 409
  account-conflict.
- A new **Select / Combobox** UI primitive (the kit currently has no
  select/combobox) for the group editor and filters.

Honor the Base UI hydration gotcha: never nest a Base-UI-derived component in
another primitive's `render` prop — style the outer primitive with the inner's
CVA classes instead.

## Errors & edge cases

- Unauthenticated view request → redirect to login; unauthenticated mutation →
  401; non-admin mutation → 403.
- Identity add collision → 409 (key owned elsewhere).
- Merge into self → 400; merge with dual distinct accounts → 409.
- Unknown player id → 404.
- Empty/whitespace group name → 400; duplicate name resolves to the existing tag
  (no error).

## Build sequence (two PRs)

**PR-A — views / read (independent, verifiable with synthetic data):**

1. Schema + migration: `player.status`, `player.isBot`, `group_tag`,
   `player_group_tag`.
2. Extend read-time derivation to carry IP onto sessions; `getPlayerDetail` +
   the enriched `getPlayersOverview` (groups, status, pills, per-server scope).
3. Relax `/dashboard/players` gate + move the nav link.
4. Player detail page, per-server players page, scoped drill-in, enriched list
   (pills, groups, status badge, filters) + the Select/Combobox primitive.

**PR-B — management / write:**

5. Mutation endpoints (`PATCH` fields; groups; identities; merge; search) + their
   shared fake-DAO-tested handlers.
6. Admin islands (`PlayerFieldsEditor`, `PlayerGroupsEditor`,
   `PlayerIdentitiesEditor`, `MergePlayerDialog`) + admin-only sections (notes,
   IPs-seen, connection attempts).

## Testing

- **Shared pure logic** (vitest, fake DAO, as in #25a): session IP carry,
  `getPlayerDetail` / overview assembly + per-server scoping + filters, merge
  combine rules (notes append, isBot OR, account-conflict detection,
  identity re-pointing), group-name normalization/match.
- **Mutation handlers:** admin gating (401/403), happy paths, and conflicts
  (duplicate identity 409, merge account-conflict 409, merge-into-self 400).
- **Web:** `nx build/lint/test web`; Astro pages render; island hydration
  verified against the Base UI gotcha.
- **Schema:** migration applies cleanly (`web:migrate:local`) and is additive.

## Out of scope (later sub-projects)

- #25c: Discord-webhook notifications (first-per-server sighting, new-player
  whitelist rejection, bot escalation) honoring the `status` / `isBot` model; IP
  retention / purge policy.
- #25a PR-2: the Go `voz-gg-agent logparse` producer, including the join-line IP
  capture the IP columns depend on.
