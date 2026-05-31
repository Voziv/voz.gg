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
- `services/` — long-running processes (HTTP/RPC servers, monitors). Polyglot: Go daemons or Cloudflare Workers (`events-ingest` is a TS Worker; `status-monitor` is Go).
- `tools/` — commands you invoke on demand. A long-running `watch`/daemon subcommand still lives here (`mc-logparser`).
- `libs/` — shared TS (`shared`) and Go (`go-shared`) code.

Single root `go.mod` (module `voz.gg`); Go projects import each other as `voz.gg/<path>`. TS path alias `@voz/shared`.

## Tags & boundaries

Every project is tagged `type:app|service|tool|lib` + `lang:ts|go`. `@nx/enforce-module-boundaries` restricts every type to depend only on `type:lib`. Add tags to a new project's `project.json`.

## Commits & PRs

Conventional commits are mandatory: `<type>(<scope>): <subject>`.

- **Types:** `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- **Scope (recommended):** a project name — `web`, `events-ingest`, `status-monitor`, `mc-logparser`, `shared`, `go-shared`. Omit the scope for repo-wide changes. Scope is advisory, not enforced as an enum.
- **Subject:** imperative mood ("add" not "added"), no trailing period, ~50 chars.
- **Enforcement:** a local `commit-msg` hook (husky + commitlint) rejects bad messages at author time; CI re-lints **every commit** in the PR range.
- **Merge model:** rebase + fast-forward (no squash, no merge commits), so **every** commit lands on `main` individually and must comply. `nx release` attributes version bumps to a project by the files each commit changes — granular, well-scoped commits drive accurate independent per-project versioning; a broad multi-project commit bumps every project it touches.

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

## Tech notes (carried from the source Next.js app, apply when porting UI)

**React islands** — the dashboard ports shadcn/ui components (built on **Base UI**, `base-vega` style) as `@astrojs/react` islands. **Tailwind 4** uses `@tailwindcss/postcss`, CSS-configured with OKLch variables — no `tailwind.config.*`.

**Base UI hydration gotcha** — Don't nest a Base-UI-derived component (`Button`, `Badge`, etc.) inside another Base UI primitive's `render` prop, e.g. `<DialogTrigger render={<Button/>}>`. Both run `useRender` and set `data-slot`; the merge order diverges between SSR and client and causes a hydration mismatch. Instead style the outer primitive with the inner's CVA classes: `<DialogTrigger className={cn(buttonVariants({ variant, size }))}>`. Same for `Popover.Trigger`, `Menu.Trigger`, etc.

**React Compiler** — when enabled, avoid manual `useMemo`/`useCallback` unless there's a specific reason.
