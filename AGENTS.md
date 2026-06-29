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
- `tools/` — commands you invoke on demand. (The Minecraft log parser is now the `voz-gg-agent logparse` subcommand, not a separate tool.)
- `libs/` — shared TS (`shared`) and Go (`go-shared`) code.

Single root `go.mod` (module `voz.gg`); Go projects import each other as `voz.gg/<path>`. TS path alias `@voz/shared`.

## Tags & boundaries

Every project is tagged `type:app|service|tool|lib` + `lang:ts|go`. `@nx/enforce-module-boundaries` restricts every type to depend only on `type:lib`. Add tags to a new project's `project.json`.

## Commits & PRs

Conventional commits are mandatory: `<type>(<scope>): <subject>`.

- **Types:** `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- **Scope (recommended):** a project name — `web`, `events-ingest`, `voz-gg-agent`, `shared`, `go-shared`. Omit the scope for repo-wide changes. Scope is advisory, not enforced as an enum.
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
agent token, validated against `server_agent`). It runs as its own Worker on a
dedicated Custom Domain **`ingest.voz.gg`** (set via `routes` with
`custom_domain = true` in its `wrangler.toml`). It needs a separate host because
`voz.gg` is itself a Custom Domain on the web Worker, which captures the whole
host and so cannot carve out a path route to another Worker. The web Worker hands
the agent this host as **`ingestBaseUrl`** in the enroll/`/api/agents/config`
response (sourced from the `INGEST_BASE_URL` var); the agent stores it in
`monitor.json` and posts presence there, distinct from `workerBaseUrl` (the web
Worker, used for monitor/config). The logparse producer falls back to
`workerBaseUrl` when `ingestBaseUrl` is absent (pre-existing enrollments), and
the Go `Reporter` does not follow redirects so a misroute surfaces as a loud
error instead of a silent 200 from a login page. Bodies are batches of events typed
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
batches to `ingest.voz.gg/presence` (Bearer = the agent token from the monitor config; log
directory via `-log-dir`, checkpoint advances only on ack). It understands both
the vanilla/Paper log prefix (`[HH:MM:SS]`, date from the file/anchor) and the
Forge/NeoForge prefix (`[ddMMMyyyy HH:mm:ss.SSS] [thread] [logger]:`, date inline),
and a **single correlator is shared across the whole run** so a player's UUID
(announced on a `UUID of player` line) and online/offline state carry across log
files. A `lost connection` line only becomes a `connection_rejected` when the
name has a resolved UUID and is not currently online — so a normal quit (already
covered by `left the game`) and anonymous pre-auth scans are both dropped.
`voz-gg-agent setup`
now decodes the enroll `provisioning.capabilities.logParser` block and, when log
parsing is enabled, resolves the game-server log directory (interactively via
`/dev/tty`, or from the provisioned `logPath` with `--non-interactive`) and
installs + enables a second hardened unit `voz-gg-agent-logparse.service` — runs
as `voz-gg` with `SupplementaryGroups=<gameServerUser>`, `ProtectHome=read-only`,
a read-only log dir, and the checkpoint under `/var/lib/voz-gg-agent`. The
server form exposes an **Enable log parsing** toggle (`logParserEnabled`,
persisted on create/edit); enroll then emits `capabilities.logParser.enabled`
and `voz-gg-agent setup` installs the logparse unit accordingly.

To apply config or capability changes to an **already-installed** agent without a
re-enroll, run `sudo voz-gg-agent reprovision` on the host. It re-fetches
`/api/agents/config` (which now also returns `provisioning`) using the existing
agent token — **no token rotation** — rewrites `monitor.json`, reconciles the
logparse unit (installs it when log parsing was turned on, disables + removes it
when turned off), and restarts the affected units so changes take effect
immediately. The edit-server modal surfaces this command. Contrast with re-running
the installer, which re-enrolls and requires a fresh single-use token.

To bring a host fully current, run `sudo voz-gg-agent update`. It is a two-phase
self-update: **phase one** (old binary) downloads the latest release asset for the
host's OS/arch from the rolling `voz-gg-agent-latest` GitHub release (the same
source the installer uses), and if the downloaded version differs it atomically
swaps it in over the running executable, then re-execs the now-current binary with
an internal `--reconcile-only`; **phase two** (new binary) refreshes config and
reconciles units — when `monitor.json` holds a valid agent key it runs the same
flow as `reprovision` (re-fetch provisioning with the existing token, rewrite
config, add/remove/update the logparse unit, restart), and with no key it simply
restarts the installed units onto the new binary. Re-execing is what guarantees
the reconcile uses the *new* release's logic, not the running (old) binary's. The
download is buffered and only renamed into place on success, so a failed fetch
never corrupts the installed binary; the swapped binary's version is verified by
running it before the swap is trusted. `--url` overrides the source for testing.
So `update` = upgrade binary **and** reconcile; `reprovision` = reconcile only
(no download).

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

### Server control + RCON

When the Worker provisions a server with `capabilities.serverControl.enabled`, the
agent mints a random RCON password locally via `ensureRconPassword` and stores it
in `monitor.json` under `rcon.password`/`rcon.port`. The Worker **never sees this
password** — it flows only between `monitor.json` and the game-server's
`server.properties` (written by `reconcileServerControl`).

`reconcileServerControl` manages two systemd units per server slug:

- **`voz-gg-<slug>.service`** — runs the game server as `<serverUser>` (foreground
  `exec java …`, no loop, so systemd controls restarts). Its `ExecStop` calls
  `voz-gg-agent rcon --properties <props-path> stop` to send a graceful RCON `stop`
  before systemd sends SIGTERM. The properties file is readable by `<serverUser>`,
  so the ExecStop can authenticate without touching `monitor.json`.
- **`voz-gg-<slug>-restart.timer` + `voz-gg-<slug>-restart.service`** — optional
  scheduled restart. The restart service warns players via RCON (`say Server
  restarting…`) before issuing a `stop`; it uses `-` prefixes so a failed warn
  doesn't abort the stop.

`reconcileServerControl` is called from both `setup` (first install) and
`reprovision` (capability updates). It never restarts a running game server on
reprovision — RCON-setting changes take effect on the server's next restart.

`voz-gg-agent rcon [flags] [command…]` — RCON subcommand with two password sources:

- **Default:** reads `rcon.password` / `rcon.port` from the agent's `monitor.json`
  (requires the agent config to have server control enabled).
- **`--properties <path>`:** reads `rcon.password` and `rcon.port` directly from a
  `server.properties` file — used by the game-server unit's `ExecStop`, which runs
  as the server user and may not have access to `monitor.json`.

Without a positional command argument the subcommand starts an interactive REPL
(reads stdin line-by-line). With a command it runs one shot and exits.

### Presence notifications (#25c)

`events-ingest` is both producer and consumer of the `voz-gg-notifications` queue.
`handlePresenceBatch` returns `notable` events (newly-inserted join/connection_rejected
with an identity); the `fetch` handler enqueues them and the `queue` handler runs the pure
`evaluateNotifications` (`libs/shared/src/notifications.ts`), POSTs a per-server
`discordWebhookUrl`, and writes a `notification_log` row for dedup/cooldown/audit. Four
triggers (bot/muted escalation, blocked-return, first-sighting, new-player-rejection) with
per-player `muted` silencing the routine three. One-time setup before deploy:
`wrangler queues create voz-gg-notifications`.

### Update apply (sub-project 2)

Building on the detect+notify slice, the agent now **applies** updates on a
canonical install layout, proven on **vanilla only** (loaders/modpacks are later
sub-projects). The layout's root is the server working dir: `current` →
`releases/<version>/server.jar`, with full working-dir `snapshots/<id>/`
(hardlink-based, retention N=3). The Worker resolves a *desired release* — version
+ artifact `{url, hashAlgo:'sha1', hash, size}` from Mojang — and ships it in a new
`capabilities.updates` block (`{enabled, policy, desired}`) of the
`/api/agents/config` provisioning response; operational fields come from
`serverControl`, which `updates` requires. `policy=auto` desireds are computed by
the `events-ingest` cron (`applyAutoDesired`, after `detectAndNotify`); `approve`
and rollback desireds are written by admin routes `POST
/api/servers/<id>/update/{approve,rollback}`. **Validation gates apply policies,
not detection:** `notify` stays Worker-only and needs no server control; only
`approve`/`auto` require `serverControlEnabled`, and `auto` additionally requires a
`restartSchedule`.

On-host, a privileged `voz-gg-agent-updates.timer` (one-shot
`voz-gg-agent updates --reconcile-once` every ~5 min, installed only when the
capability is on, scoped `ReadWritePaths` to the server dir + state dir) converges
installed→desired: guided adoption of a flat server (identify version from the
jar's `version.json`, move to `releases/<v>/`, create `current`) → trigger gate
(empty via RCON `list`, or within the `restartSchedule`+15min window) → snapshot →
download+verify (hash mismatch aborts before any swap) → repoint `current` →
restart → RCON health-check, **auto-reverting to the snapshot on a failed boot**.
It then POSTs full updater state to `POST /api/agents/updates`, which makes
`servers.currentVersion` truthful, mirrors the snapshot inventory into
`server_snapshot`, appends a `server_update_event` audit row, and posts a per-server
Discord alert (the #25c webhook, called directly — no queue) on a failed/auto_revert
event. The dashboard surfaces apply status on the update badge and gives admins
approve / rollback (snapshot picker) / history controls. Pure cores
(`libs/shared/src/server-updates/{artifact,desired,desired-run,updates-report}.ts`,
the agent's trigger gate / reconcile / snapshot / executor) are fake-tested; migration
0016/0017 plus 0018 (desired columns, `server_snapshot`, `server_update_event`) back it.

### Loader installers (sub-project 3)

Building on the vanilla apply slice, the agent now applies **Forge, NeoForge, and
Fabric** updates via their **installer jars**. The Worker resolves each loader's
installer from its own Maven (NeoForge `.sha256`, Forge/Fabric `.sha1`,
hash-verifiable) and ships an `install {loader, minecraftVersion, loaderVersion}`
descriptor alongside `desired.artifact` in `capabilities.updates`. On-host the
agent downloads + verifies the installer, runs it (`--installServer`; Fabric:
`server -mcversion <mc> -loader <loader> -downloadMinecraft`) into
`releases/<version>.staging/`, validates loader markers, **atomically renames** to
`releases/<version>/`, then runs the existing snapshot → stop → repoint `current` →
start → RCON health-check → **auto-revert on failed boot** (restores `current`, the
world, and the prior unit `ExecStart`).

The agent **derives the launch** for loader servers (`deriveLaunch`) and writes it
into the game unit's `ExecStart`, creating bridge symlinks (`libraries`→`current/…`,
plus Fabric's `server.jar`/properties) so versioned loader libraries resolve while
world/mods/config stay in the working dir. `serverJvmArgs` supplies JVM/memory flags
(default `-Xmx2G`); a user-provided `startCommand` is the fallback only until a
loader release is installed — on reprovision, `effectiveStartCommand` re-derives the
launch from the installed release on disk so the derived `ExecStart` is not clobbered.

**Adoption** is loader-aware: `identifyFlatInstall` identifies the loader TYPE from
disk (the cross-check), but does **not** require the on-disk version to equal
desired — the normal apply path updates it afterward. The Worker is the source of
truth for the loader; a flat install that doesn't parse as the declared loader aborts
loudly and touches nothing. Fabric flat-adoption trusts the Worker-declared loader
version (the on-disk fabric version is not recoverable from the jar layout).

A real **world backup** (CoW reflink, deep-copy fallback, quiesced via RCON
`save-off`) is now part of the **shared** snapshot path, so rollback restores the
world for vanilla and loaders alike; retention stays N=3. Modpacks stay out
(`artifactResolverFor` returns null). The per-loader recipe lives in one `loaderSpec`
table (`loaderspec.go`). Migration 0019 adds the nullable `desired_install_*` columns
and `servers.server_jvm_args`.

**Deferred verification:** the exact loader launch recipes (`loaderSpec` /
`deriveLaunch` strings, bridge symlinks) reflect documented NeoForge/Forge/Fabric
conventions but were **not yet verified** against real installer output on a JDK host
(Task 12 deferred) — verify on a host before trusting on a production server (Fabric
especially).

## Tech notes (carried from the source Next.js app, apply when porting UI)

**React islands** — the dashboard ports shadcn/ui components (built on **Base UI**, `base-vega` style) as `@astrojs/react` islands. **Tailwind 4** uses `@tailwindcss/postcss`, CSS-configured with OKLch variables — no `tailwind.config.*`.

**Base UI hydration gotcha** — Don't nest a Base-UI-derived component (`Button`, `Badge`, etc.) inside another Base UI primitive's `render` prop, e.g. `<DialogTrigger render={<Button/>}>`. Both run `useRender` and set `data-slot`; the merge order diverges between SSR and client and causes a hydration mismatch. Instead style the outer primitive with the inner's CVA classes: `<DialogTrigger className={cn(buttonVariants({ variant, size }))}>`. Same for `Popover.Trigger`, `Menu.Trigger`, etc.

**React Compiler** — when enabled, avoid manual `useMemo`/`useCallback` unless there's a specific reason.
