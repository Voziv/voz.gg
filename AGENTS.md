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

## Cloudflare / data

- Frontend deploys as Astro SSR via `@astrojs/cloudflare`; the landing page is `export const prerender = true`, dashboard routes are server-rendered. Data is **Cloudflare D1**; Drizzle schema/types/client live in `libs/shared`. Migration artifacts live in `apps/web/drizzle/migrations`.
- Generate migrations: `cd apps/web && npx drizzle-kit generate`. Apply: `npx wrangler d1 migrations apply voz-gg --local` (and `--remote` for prod).
- Secrets: `.dev.vars` locally (gitignored), `wrangler secret put` in prod; non-secrets in wrangler `vars`.
- Go services on physical servers authenticate to Worker APIs with a shared Bearer token.

## Tech notes (carried from the source Next.js app, apply when porting UI)

**React islands** — the dashboard ports shadcn/ui components (built on **Base UI**, `base-vega` style) as `@astrojs/react` islands. **Tailwind 4** uses `@tailwindcss/postcss`, CSS-configured with OKLch variables — no `tailwind.config.*`.

**Base UI hydration gotcha** — Don't nest a Base-UI-derived component (`Button`, `Badge`, etc.) inside another Base UI primitive's `render` prop, e.g. `<DialogTrigger render={<Button/>}>`. Both run `useRender` and set `data-slot`; the merge order diverges between SSR and client and causes a hydration mismatch. Instead style the outer primitive with the inner's CVA classes: `<DialogTrigger className={cn(buttonVariants({ variant, size }))}>`. Same for `Popover.Trigger`, `Menu.Trigger`, etc.

**React Compiler** — when enabled, avoid manual `useMemo`/`useCallback` unless there's a specific reason.
