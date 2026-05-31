---
date: 2026-05-30
feature: Data backbone + profile management (dashboard, shadcn/Base UI, Minecraft linking)
status: designed
sub_project: 4 of 6 (port-decomposition-roadmap)
---

# voz.gg — Data backbone + profile management

## Context

Sub-project #4 in the port of `game-server-panel` (Next.js) into the `voz.gg`
Astro + Cloudflare monorepo. Builds directly on #3 (auth): the `user`/`session`
schema, `Astro.locals.user`, the better-auth client, and the Steam-linking
routes already exist. This sub-project delivers the authenticated **dashboard**,
**profile management**, **Minecraft linking**, the **`servers` table**, and a
**read-only servers list**.

The dashboard ports the source's **shadcn/ui in `base-vega` style on Base UI**
(`@base-ui/react`), per AGENTS.md. Decision (confirmed 2026-05-30): **full
shadcn port** — proper Base UI components, not a plain-Tailwind stand-in.

Source surface: `src/app/dashboard/{layout,profile,servers}`,
`src/components/ui/*`, `src/components/dashboard/*`, `src/lib/mojang.ts`,
`components.json` (style `base-vega`, Base UI, lucide).

## Decisions

- **UI:** full shadcn/`base-vega` port on Base UI as React islands.
- **Profile name/bio:** edited via better-auth `authClient.updateUser({ displayName, bio })`
  (both are `input:true` additional fields from #3) — a client island form.
- **Minecraft linking:** server-side only (fields are `input:false`). A custom
  `POST /api/profile/minecraft` route runs the Mojang lookup and persists; the
  island calls it. Mirrors the Steam-linking pattern from #3.
- **Sidebar / layout:** the dashboard shell is an **Astro layout** with a
  server-rendered sidebar (active state from `Astro.url.pathname`) — no island
  needed for nav. Islands are used only where interactivity is required (forms,
  toaster, sign-out).
- **`servers` table:** defined here; **reads only** in #4. Inserts/edits/deletes
  are #5; live status is #6.

## Goals

- A real authenticated dashboard replacing the #3 placeholder.
- Users can edit display name/bio, link/unlink Minecraft, and see their Steam link.
- The `servers` table exists and its rows render read-only.

## Non-goals (out of scope)

- **Admin server CRUD** (create/edit/delete, the `ServerFormDialog` /
  `DeleteServerButton`, admin gating) — sub-project #5.
- **Live server status** (`checkServerStatus`, real `StatusBadge` data) — #6.
  The status column shows a neutral placeholder until then.
- Porting unused shadcn primitives (e.g. `dialog` — only #5's server form needs
  it). Port only what #4's pages use.

## Architecture & components

### A. Schema — `libs/shared/src/schema.ts`

Add the `servers` table:

| column | type | notes |
|--------|------|-------|
| `id` | text PK | nanoid(12), supplied at insert (insert lands in #5) |
| `name` | text notNull | |
| `game_type` | text notNull | one of `minecraft-java`/`minecraft-bedrock`/`source`/`generic-tcp`/`unknown`; typed as a TS union exported from the schema module |
| `host` | text notNull | |
| `port` | integer notNull | |
| `description` | text | nullable |
| `created_by` | text notNull, FK→`user.id` | |
| `created_at`/`updated_at` | integer timestamp notNull | |

Generate D1 migration `0002`; apply `--local` (and document `--remote` for prod).

### B. shadcn/Base UI foundation

- **Dependencies:** `@base-ui/react`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `lucide-react`, `sonner`, `tw-animate-css`.
- **`apps/web/src/lib/utils.ts`** — `cn()` (clsx + tailwind-merge).
- **`apps/web/src/styles/global.css`** — add the deferred `@import "tw-animate-css";`
  and the shadcn base layer (`@import "shadcn/tailwind.css";` or the equivalent
  base-vega base styles). The OKLch theme + `--color-sidebar-*` tokens are
  already present from the landing foundation.
- **`apps/web/src/components/ui/`** — port the primitives #4 uses, each a Base
  UI-based React component with CVA variants and `data-slot`:
  `button`, `card`, `input`, `label`, `avatar`, `badge`, `skeleton`, `sonner`
  (Toaster).
- **Base UI hydration gotcha (AGENTS.md):** never nest a Base-UI-derived
  component inside another primitive's `render` prop. Style the outer primitive
  with the inner's CVA classes (`className={cn(buttonVariants({...}))}`) instead.
  Each island that uses these mounts via `client:load`.

### C. Dashboard shell — `apps/web/src/layouts/Dashboard.astro`

- Sidebar (`aside`, `hidden md:block`) with nav links Profile / Servers; active
  state derived from `Astro.url.pathname` (server-rendered, no island).
- Header with a **user chip** (avatar + name from `Astro.locals.user`) and a
  **sign-out** control (a small island calling `authClient.signOut()`, or a
  `POST /api/auth/sign-out` form).
- A `<Toaster client:load />` (sonner) for form feedback.
- `<slot/>` for page content. Used by the dashboard pages below.
- `/dashboard` index → redirect to `/dashboard/profile` (or a thin overview).
  Route protection already enforced by #3 middleware.

### D. Profile page — `apps/web/src/pages/dashboard/profile.astro`

Server-renders the user from `Astro.locals.user`, composing three cards:

1. **About you** — a `ProfileForm` island (display name + bio inputs) calling
   `authClient.updateUser({ displayName, bio })`; toast on success.
2. **Minecraft** — a `MinecraftField` island: username input → `POST
   /api/profile/minecraft` → shows linked UUID/name; an unlink action clears it.
3. **Steam** — a `SteamLinkCard` showing linked persona/avatar (from #3 fields)
   or a "Link Steam" button hitting `/api/auth/steam/initiate` (from #3).
   `?steam=linked|conflict|error` query params (set by #3's callback) surface as
   a banner/toast.

### E. Minecraft API + lib

- **`apps/web/src/lib/mojang.ts`** (TDD, ported from source): `isValidMinecraftUsernameSyntax`,
  `lookupMinecraftProfile(username, fetchFn?)` → `{ uuid (dashed), name } | null`
  via `https://api.mojang.com/users/profiles/minecraft/<username>` (404/204/!ok → null).
- **`POST /api/profile/minecraft`** — requires session (`Astro.locals.user`);
  body `{ username }`; validates syntax; looks up Mojang; on hit persists
  `minecraft_uuid`/`minecraft_name` to the user row (drizzle); returns
  `{ ok, uuid, name }` or an error. A `DELETE`/empty action unlinks (clears both).
  Env via `import { env } from 'cloudflare:workers'`.

### F. Servers page — `apps/web/src/pages/dashboard/servers.astro`

- Reads `servers` from D1 (drizzle) server-side; renders the table (name +
  description, game label, `host:port`). Empty state when none.
- **Status column:** neutral placeholder (`StatusBadge` with an "unknown"/`—`
  state) until #6 wires live data.
- **No admin actions** in #4 (Add/Edit/Delete are #5).

## Data flow

- Read: middleware → `Astro.locals.user`; pages server-render from it + D1 reads.
- Profile name/bio: island → better-auth client → better-auth updates the `user`
  row (additionalFields) → toast.
- Minecraft: island → `POST /api/profile/minecraft` → Mojang fetch → drizzle
  update → island reflects result.
- Steam: existing #3 routes; profile surfaces the stored fields.

## Error handling

- Mojang lookup miss / invalid username → field shows "not found", no write.
- Minecraft route requires a session (else 401/redirect).
- Profile update failure → error toast.
- Steam `?steam=conflict|error` → banner.

## Testing / acceptance

- `nx test web` (Mojang lib TDD'd: valid/invalid syntax, found/404/!ok → null,
  UUID dashing), `nx lint web`, `nx build web` all pass.
- Migration `0002` applies locally; `servers` table present.
- Dashboard renders with the sidebar; protected (unauth → `/sign-in`, from #3).
- Editing display name/bio persists (visible after reload).
- Linking a valid Minecraft username persists `minecraft_uuid`/`minecraft_name`;
  an invalid one is rejected; unlink clears them.
- Steam link status surfaces on the profile.
- Servers page renders the (initially empty) table; a manually-inserted row
  shows name/game/address with the placeholder status.
- Islands hydrate without Base UI hydration-mismatch warnings.

## Files (indicative)

| path | action |
|------|--------|
| `libs/shared/src/schema.ts` | edit — add `servers` table + `gameType` union |
| `apps/web/drizzle/migrations` | add — generated `0002` |
| `apps/web/src/lib/utils.ts` | create — `cn()` |
| `apps/web/src/lib/mojang.ts` (+ test) | create — Mojang lookup (TDD) |
| `apps/web/src/components/ui/{button,card,input,label,avatar,badge,skeleton,sonner}.tsx` | create — base-vega primitives |
| `apps/web/src/components/dashboard/{UserChip,ProfileForm,MinecraftField,SteamLinkCard,StatusBadge,ErrorBanner,SignOut}.tsx` | create — islands/components |
| `apps/web/src/layouts/Dashboard.astro` | create — dashboard shell |
| `apps/web/src/pages/dashboard/index.astro` | replace — redirect/overview |
| `apps/web/src/pages/dashboard/profile.astro` | create |
| `apps/web/src/pages/dashboard/servers.astro` | create |
| `apps/web/src/pages/api/profile/minecraft.ts` | create — link/unlink |
| `apps/web/src/styles/global.css` | edit — add tw-animate-css + shadcn base layer |
| `apps/web/package.json` | edit — Base UI, cva, clsx, tailwind-merge, lucide-react, sonner, tw-animate-css (nanoid deferred to #5, which does the inserts) |

## Sequencing notes

- This is the **largest** sub-project (full shadcn port + dashboard + profile +
  data). If it proves too big for one implementation plan, the natural split is
  **4a:** shadcn/Base UI foundation + dashboard shell, **4b:** profile + Minecraft
  + servers read. Default: one plan; reassess at planning time.
- **#5 (admin server CRUD)** builds on the `servers` table and dashboard here,
  adding `dialog` + the server form/delete components and admin (`role`) gating.
- **#6 (status monitor)** replaces the placeholder status with live data.
- React islands + Base UI arrive in force here — the hydration gotcha is the
  main risk to watch.
