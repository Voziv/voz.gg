# AGENTS.md

voz.gg is an NX polyglot monorepo: an Astro SSR frontend + Cloudflare Workers, with Go services/CLIs that run on physical servers.

## Commands

- `nx dev web` — Astro dev server for the site
- `nx run web:preview` — full Worker + assets + D1 locally (wrangler dev)
- `nx build <project>` — build one project; `nx run-many -t build` for all
- `nx test <project>` / `nx run-many -t test` — tests (Go via nx-go)
- `nx lint <project>` — ESLint (TS) with module-boundary enforcement
- `nx deploy web` / `nx deploy events-ingest` — build + `wrangler deploy`
- `nx serve <go-project>` — run a Go service/CLI locally
- `nx affected -t build,test,lint` — only what changed

## Structure

Projects are categorized by identity, not runtime mode:

- `apps/` — front-ends (Astro `web`).
- `services/` — long-running processes (HTTP/RPC servers, monitors). Polyglot: Go daemons or Cloudflare Workers (`events-ingest` is a TS Worker; `voz-gg-agent` is Go).
- `tools/` — commands you invoke on demand. A long-running `watch`/daemon subcommand still lives here (`mc-logparser`).
- `libs/` — shared TS (`shared`) and Go (`go-shared`) code.

Single root `go.mod` (module `voz.gg`); Go projects import each other as `voz.gg/<path>`. TS path alias `@voz/shared`.

## Tags & boundaries

Every project is tagged `type:app|service|tool|lib` + `lang:ts|go`. `@nx/enforce-module-boundaries` restricts every type to depend only on `type:lib`. Add tags to a new project's `project.json`.

## Commits & PRs

Conventional commits are mandatory: `<type>(<scope>): <subject>`.

- **Types:** `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- **Scope (recommended):** a project name — `web`, `events-ingest`, `voz-gg-agent`, `mc-logparser`, `shared`, `go-shared`. Omit the scope for repo-wide changes. Scope is advisory, not enforced as an enum.
- **Subject:** imperative mood ("add" not "added"), no trailing period, ~50 chars.
- **Enforcement:** a local `commit-msg` hook (husky + commitlint) rejects bad messages at author time; CI re-lints **every commit** in the PR range.
- **PR title:** must itself be a conventional commit (`<type>(<scope>): <subject>`). GitHub is set to use the **PR title** as the merge commit subject (and the PR body as its message), so the title — not just the commits — drives `nx release` and is linted on `main`.
- **Merge model:** PRs land via a **merge commit** — the only method enabled (rebase and squash are off in repo settings). The merge commit carries the PR title (see above); the branch's own commits are preserved on `main` too, and CI re-lints **every commit** in the PR range, so each must also comply. `nx release` attributes version bumps to a project by the files each commit changes — well-scoped PRs drive accurate independent per-project versioning; a broad multi-project PR bumps every project it touches.

### DCO sign-off (required)

Every commit must carry a `Signed-off-by: Name <email>` trailer matching the author, or the **DCO** check on the PR fails and it cannot merge.

- **Always commit with `git commit -s`.** This is the only reliable rule — it works even when hooks are skipped.
- A `prepare-commit-msg` hook auto-appends the trailer if you forget `-s`, but it is only a safety net: **`git commit --no-verify` skips it** (and every other hook). If you bypass hooks, you MUST still pass `-s`.
- Agents/automation: never push a commit without verifying the trailer is present (`git log -1 --format=%B | grep Signed-off-by`). To fix a missing trailer on the last commit: `git commit --amend -s --no-edit` then force-push.

## Cloudflare / data

- Frontend deploys as Astro SSR via `@astrojs/cloudflare`; the landing page is `export const prerender = true`, dashboard routes are server-rendered. Data is **Cloudflare D1**; Drizzle schema/types/client live in `libs/shared`. Migration artifacts live in `apps/web/drizzle/migrations`.
- Generate migrations: `cd apps/web && npx drizzle-kit generate`. Apply: `npx wrangler d1 migrations apply voz-gg --local` (and `--remote` for prod).
- Secrets: `.dev.vars` locally (gitignored), `wrangler secret put` in prod; non-secrets in wrangler `vars`.
- Go services on physical servers authenticate to Worker APIs with a shared Bearer token.

### Schema migrations

The `Deploy` workflow (`.github/workflows/deploy.yml`) runs `nx affected -t migrate` **before** `nx affected -t deploy`, so a push to `main` applies pending D1 migrations to prod and then ships the code. Locally, the targets are separate: `nx run web:migrate` (remote) and `nx run web:migrate:local`.

Because migrations run before the new code, **every migration must be backward-compatible with the code currently running in prod** (expand/contract). Additive changes (new tables/columns, new nullable fields) satisfy this automatically. A **destructive** change (dropping/renaming a column or table, narrowing a type, adding a NOT NULL/UNIQUE constraint) is not backward-compatible and would break the live code the instant the migration lands. Split it across **three separate deploys**, each merged and shipped on its own:

1. **Expand — teach the code both shapes.** Update the code to read/write both the old and the new state (e.g. read from either column, write to both; tolerate the column being absent). No destructive migration yet. Deploy.
2. **Migrate — the destructive change.** Now that the running code no longer depends on the old state, ship the destructive migration. Deploy.
3. **Contract — remove the old path.** Delete the now-dead old-state handling from the code. Deploy.

Never collapse these into one PR: doing so reintroduces the window where prod code expects schema that no longer exists. Keep each step in its own commit/PR so the deploy boundary falls between them.

### Roles & the owner

User roles are `user`, `admin`, and a single `owner` (better-auth access-control; see `apps/web/src/lib/permissions.ts`). The `owner` is a super-admin that no other admin can ban/delete/demote; only the owner can change roles and transfer ownership. A migration promotes the earliest-created `admin` to `owner` on existing installs. On a **fresh install** with no admins, promote the first account manually, then set the owner:

```sh
npx wrangler d1 execute voz-gg --remote --command \
  "UPDATE \"user\" SET role='owner' WHERE email='you@example.com'"
```

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
them via `getPlayersOverview`. The Go `voz-gg-agent logparse` producer is
implemented: it backfills rolled `*.log.gz` then tails `latest.log`, parses
join/leave/connection_rejected/server_start/server_stop, and POSTs idempotent
batches to `/presence` (Bearer = the agent token from the monitor config; log
directory via `-log-dir`, checkpoint advances only on ack). Installer/systemd
wiring of the unit and the web enable toggle land separately.

The host installer (`apps/web/public/install-agent.sh`) is a thin bootstrap: it
downloads `voz-gg-agent` and execs `voz-gg-agent setup`, which enrolls, creates a
dedicated unprivileged **`voz-gg`** system user, writes `/etc/voz-gg-agent/monitor.json`
owned by it, and installs a hardened `voz-gg-agent-monitor.service` that runs the
agent as `voz-gg` (not root). Because it creates a user and a service, the install
command must run as root: `curl … | sudo sh -s -- <token>`.

**Player management & views (#25b):** any logged-in user can browse
`/dashboard/players`, a player detail view (`/dashboard/players/<id>`, with
`?server=<id>` scoping), and a per-server roster
(`/dashboard/servers/<id>/players`). Players carry a `status`
(`new`/`allowed`/`blocked`, default `new`) and an informational `isBot` flag;
freeform groups live in `group_tag` + `player_group_tag`. Sessions, IPs, and
connection attempts are derived at read time (`libs/shared/src/player-detail.ts`);
"seen on a server" means actual presence, so connection rejections never count
toward servers-seen or last-seen. Admin/owner see the management surfaces
(status, notes, IPs, attempts) and edit them (PR-B): rename + status + isBot +
notes, freeform groups (add-or-create / remove), manual identities (add / remove),
and **merge** (survivor re-homes the absorbed player's identities, groups, notes,
and account link; 409 on dual distinct accounts). The write surface is
admin-gated routes `PATCH /api/players/<id>`, `POST|DELETE /api/players/<id>/groups`,
`POST|DELETE /api/players/<id>/identities`, `POST /api/players/<id>/merge`, and
`GET /api/players/search`, all thin wiring over fake-DAO-tested handlers in
`libs/shared/src/player-mutations.ts`; the editors are React islands using new
Base UI `select`/`combobox` primitives. IP columns stay empty until the #25a PR-2
log producer captures join IPs.

## Tech notes (carried from the source Next.js app, apply when porting UI)

**React islands** — the dashboard ports shadcn/ui components (built on **Base UI**, `base-vega` style) as `@astrojs/react` islands. **Tailwind 4** uses `@tailwindcss/postcss`, CSS-configured with OKLch variables — no `tailwind.config.*`.

**Base UI hydration gotcha** — Don't nest a Base-UI-derived component (`Button`, `Badge`, etc.) inside another Base UI primitive's `render` prop, e.g. `<DialogTrigger render={<Button/>}>`. Both run `useRender` and set `data-slot`; the merge order diverges between SSR and client and causes a hydration mismatch. Instead style the outer primitive with the inner's CVA classes: `<DialogTrigger className={cn(buttonVariants({ variant, size }))}>`. Same for `Popover.Trigger`, `Menu.Trigger`, etc.

**React Compiler** — when enabled, avoid manual `useMemo`/`useCallback` unless there's a specific reason.
