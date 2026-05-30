---
date: 2026-05-30
feature: Authentication (better-auth + Steam linking)
status: designed
sub_project: 3 of 6 (port-decomposition-roadmap)
---

# voz.gg — Authentication

## Context

Sub-project #3 in the port of `game-server-panel` (Next.js) into the `voz.gg`
Astro + Cloudflare monorepo. This is the hardest port: the source uses
`@workos-inc/authkit-nextjs`, which is Next.js-middleware-bound and does **not**
port to Astro on Cloudflare Workers.

**Decision:** replace WorkOS with **better-auth**, a TypeScript-native auth
library designed for the Workers/edge runtime (Drizzle + D1 adapter, built-in
social providers, DB-backed sessions, admin and magic-link plugins). The source's
**Steam OpenID 2.0** flow is hand-rolled (`fetch` + regex, no Node-specific
deps) and ports cleanly as an **account-linking** flow.

Source auth: `~/dev/game-server-panel/src/lib/auth.ts`,
`src/lib/steam/openid.ts`, `src/lib/steam/api.ts`, `src/app/auth/*`,
`src/app/api/auth/steam/*`, `src/proxy.ts`.

## Decisions

- **Provider:** better-auth (replaces WorkOS entirely).
- **Login methods:** Discord, Google, and email magic link. **No passwords.**
- **Magic-link email sender:** Cloudflare Email Sending via a Workers binding
  (fallback option: Resend). Confirm at implementation if domain/DNS setup is a
  blocker.
- **Steam:** stays an authenticated **account-linking** flow (sign in first,
  then link), not a primary login — matching source behavior. Steam OpenID 2.0
  is not an OAuth2/OIDC provider better-auth understands, so it remains custom.
- **Admin/roles:** better-auth **admin plugin** `role` field replaces the
  source's `is_admin` boolean and the WorkOS role check.

## Goals

- A signed-in session on Cloudflare Workers via better-auth, established by any
  of the three login methods.
- Route protection via Astro middleware (replaces the source `authkitProxy`).
- Steam account linking ported faithfully, persisting Steam identity on the user.

## Non-goals (out of scope)

- Profile-editing UI, Minecraft linking, the `servers` table — sub-project #4.
- Server status monitoring — sub-project #6.
- Any WorkOS compatibility shim. WorkOS is removed, not wrapped.

## Architecture & placement

- **better-auth instance — `apps/web/src/lib/auth.ts`**
  App-specific configuration: the Drizzle (D1) adapter, the three login methods,
  the **admin** plugin, the **magicLink** plugin, session config, and trusted
  origins. The D1 `voz-gg` binding is read from `locals.runtime.env` (Cloudflare
  request context), so the instance is constructed per-request with the env's
  binding rather than at module top level.

- **API mount — `apps/web/src/pages/api/auth/[...all].ts`**
  An Astro catch-all route that delegates every `GET`/`POST` to better-auth's
  handler (social callbacks, magic-link request/verify, sign-out, session).

- **Auth schema — `libs/shared`** (per AGENTS.md: Drizzle schema/types/client
  live in `libs/shared`). Generate better-auth's tables with its CLI, then place
  the table definitions into the shared Drizzle schema and export them. A Drizzle
  migration is generated into `apps/web/drizzle/migrations` and applied with
  `wrangler d1 migrations apply voz-gg --local` (and `--remote` for prod).

- **Client — `apps/web/src/lib/auth-client.ts`**
  `createAuthClient` (React) consumed by the sign-in island and any sign-out
  control.

## Schema impact (scope shift from #4 → #3)

better-auth owns the `user` table, so this sub-project absorbs the source's
`users` definition. The `user` table = better-auth base columns **plus extended
fields**:

| field            | notes |
|------------------|-------|
| `display_name`   | user-editable (edited in #4) |
| `bio`            | user-editable (edited in #4) |
| `minecraft_uuid` | populated by #4 (Minecraft linking) |
| `minecraft_name` | populated by #4 |
| `steam_id_64`    | **unique**; set by Steam linking (this sub-project) |
| `steam_persona`  | set by Steam linking |
| `steam_avatar`   | set by Steam linking |

- `is_admin` (source) is **replaced** by the admin plugin's `role` field.
- better-auth also creates `session`, `account`, and `verification` tables.
- Sub-project #4 is left owning only the **`servers`** table plus the
  profile-editing UI and Minecraft linking.

## Login flows

### Discord / Google (social)

better-auth social providers. The sign-in island renders a button per provider →
provider redirect → better-auth callback (`/api/auth/...`) → DB-backed session
cookie set.

### Email magic link

Email input → better-auth `magicLink` plugin. The plugin's `sendMagicLink`
callback dispatches the link via Cloudflare Email Sending. Clicking the link
verifies and establishes a session. No password storage.

### Sign-in page — `/sign-in`

Custom page (better-auth ships no hosted UI): two social buttons + an email
field for the magic link. The landing page's currently-disabled Sign In button
becomes a link to `/sign-in`.

### Sign-out

better-auth client `signOut()`, clears the session cookie.

## Steam linking (ported, hand-rolled)

- **`apps/web/src/pages/api/auth/steam/initiate.ts`** — requires an active
  session; builds the Steam OpenID 2.0 login URL (port `buildSteamLoginUrl` from
  `src/lib/steam/openid.ts`) using `STEAM_REALM` / `STEAM_RETURN_URL`; redirects
  to Steam.
- **`apps/web/src/pages/api/auth/steam/callback.ts`** — requires session; verify
  the assertion (port `verifySteamOpenIdResponse`): confirm
  `openid.mode === 'id_res'`, extract `steam_id_64` from `openid.claimed_id`
  (`^https://steamcommunity\.com/openid/id/(\d{17})$`), then POST back to
  `https://steamcommunity.com/openid/login` with `check_authentication` and
  confirm `is_valid:true`. On success, call Steam `GetPlayerSummaries/v2` once
  (`STEAM_API_KEY`) for `personaname` / `avatarfull`, and persist
  `steam_id_64` / `steam_persona` / `steam_avatar` onto the session user's row.
- **Drop** the source's in-memory 5-minute Steam API cache — linking is
  infrequent, so fetch once and persist. (Per-request status display caching is
  a #6 concern.)
- All `fetch`-based; no Node-specific dependencies.

## Route protection — `apps/web/src/middleware.ts`

Astro middleware runs on every request:

1. Resolve the session from better-auth (`auth.api.getSession({ headers })`).
2. Set `Astro.locals.user` and `Astro.locals.session`.
3. **Public paths:** `/`, `/sign-in`, `/api/auth/*` (better-auth + Steam
   endpoints manage their own auth checks; Steam endpoints additionally require
   a session internally).
4. **Protected:** everything else (e.g. `/dashboard/*`) → redirect unauthenticated
   requests to `/sign-in`.

Replaces the source `authkitProxy` / `requireUser` pattern. `Astro.locals.user`
is the single source of truth for downstream pages and islands.

## Env / secrets

Stored in `.dev.vars` locally (gitignored); `wrangler secret put` in prod;
non-secret config in wrangler `vars`.

- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `STEAM_API_KEY`, `STEAM_REALM`, `STEAM_RETURN_URL`
- Cloudflare Email Sending binding (name TBD at implementation) — or
  `RESEND_API_KEY` if the fallback is chosen.

## Testing / acceptance

- `nx build web` and `nx lint web` pass; no new module-boundary violations.
- The generated Drizzle migration applies locally
  (`wrangler d1 migrations apply voz-gg --local`).
- A signed-out request to a protected route (`/dashboard`) redirects to
  `/sign-in`.
- Each login method (Discord, Google, magic link) establishes a session and lands
  the user on the dashboard; `Astro.locals.user` is populated thereafter.
- Steam linking round-trips: initiate → Steam → callback verifies and persists
  `steam_id_64` (unique), `steam_persona`, `steam_avatar` on the user row;
  re-linking a Steam ID already bound to another user is rejected by the unique
  constraint.
- Sign-out clears the session; the next protected request redirects to `/sign-in`.

## Files

| path | action |
|------|--------|
| `apps/web/src/lib/auth.ts` | create — better-auth instance (D1 adapter, providers, plugins) |
| `apps/web/src/lib/auth-client.ts` | create — better-auth React client |
| `apps/web/src/pages/api/auth/[...all].ts` | create — better-auth handler mount |
| `apps/web/src/pages/api/auth/steam/initiate.ts` | create — Steam OpenID initiate |
| `apps/web/src/pages/api/auth/steam/callback.ts` | create — Steam OpenID verify + persist |
| `apps/web/src/middleware.ts` | create — session resolution + route protection |
| `apps/web/src/pages/sign-in.astro` | create — sign-in page + island |
| `apps/web/src/pages/index.astro` | edit — enable the Sign In button → `/sign-in` |
| `libs/shared` (Drizzle schema) | edit — better-auth tables + extended user fields |
| `apps/web/drizzle/migrations` | add — generated migration |
| `apps/web/wrangler.jsonc` | edit — Email binding / vars as needed |
| `apps/web/package.json` | edit — add `better-auth`, `@astrojs/react` (first island), React deps |
| `apps/web/astro.config.mjs` | edit — register `@astrojs/react` integration |

## Dependencies & sequencing notes

- This sub-project establishes the `user`/`session`/`account`/`verification`
  schema that **#4 (data backbone)** and **#5 (server CRUD admin gate)** build on.
  #4 adds the `servers` table and profile/Minecraft UI; #5 gates CRUD on the
  admin plugin `role`.
- **#6 (status-monitor Go service)** does not depend on auth and can be built in
  parallel.
- The sign-in island is the first React island in the app, so this sub-project
  also introduces `@astrojs/react`. Mind the **Base UI hydration gotcha**
  (AGENTS.md) once shadcn/Base UI components arrive in #4.
