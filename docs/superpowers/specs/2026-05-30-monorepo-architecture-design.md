# voz.gg Monorepo Architecture — Design

**Date:** 2026-05-30
**Status:** Approved (architecture); feeds the "foundation build" sub-project.

## Context

We are porting `~/dev/game-server-panel` (Next.js 16 / React 19 gaming-community panel) into `~/dev/voz.gg` (fresh Astro 6). The target deployment is Cloudflare — Astro for the frontend/SSR, Cloudflare Workers for dynamic server-side logic — modeled on the existing `~/dev/leerobert.ca` project. Some elements will run as microservices hosted *outside* Cloudflare (Go binaries on physical servers).

The full port is too large for one spec. It is decomposed into sequenced sub-projects, each with its own spec → plan → build cycle. This document specifies **only the monorepo architecture and foundation** — the backbone every later sub-project builds on. Later sub-projects (in order): landing page, auth, database + profile management, server CRUD, server status monitoring.

## Goals

- A polyglot (TypeScript + Go) monorepo that hosts the Astro frontend, Cloudflare Worker microservices, and Go services/CLIs.
- Prove the **full deployment model end to end** before building features: an Astro SSR app, a standalone Worker microservice, and Go binaries all build and deploy from this repo.
- Establish conventions (layout, tooling, tags, secrets, docs) so each later sub-project drops in without restructuring.

## Non-goals (deferred to later sub-projects)

Auth, the real D1 schema, profile/Minecraft/Steam linking, server CRUD, and real Minecraft-ping/log-parsing logic are **out of scope** here. The example service/CLI/worker in this foundation are deployable stubs that prove the structure, not features.

## Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| Monorepo tooling | **NX** (over pnpm) + **`@nx-go/nx-go`** | User choice; task graph, caching, `nx affected`, module-boundary lint. Go plugin makes the repo polyglot. |
| Go modules | **Single root `go.mod`**, module path `voz.gg` | nx-go default; lets any service/CLI import shared `libs/go-*` with no module juggling. |
| Frontend rendering | **Astro SSR via `@astrojs/cloudflare`** adapter; landing page `prerender = true` | Auth-gated dashboard pages must render server-side (read session cookie, query D1), faithfully porting the current RSC model. Public pages prerender. |
| Data | **Cloudflare D1**, schema/migrations via **Drizzle** in `libs/shared` | Cloudflare-native; Workers + Astro own all shared data. Go services use their own databases (if any) and integrate over APIs. Hyperdrive deferred until a Worker needs direct external-DB access. |
| Inter-service data flow | Go services are autonomous; they **call Worker APIs** or **serve an API** Workers query. They do **not** touch D1 directly. | Matches user's model; keeps D1 inside the Cloudflare boundary. |
| UI port | **React islands** — add `@astrojs/react`, carry shadcn/Base-UI components over and hydrate as islands; Tailwind 4 (CSS-config, OKLch) | Faithful, fast port; reuses existing component code vs a risky full rewrite. |
| Physical-server ↔ Worker auth | Shared **Bearer secret** (wrangler secret on the Worker, env/config on the Go service) | Simple, sufficient for a personal fleet. Exact endpoints/tokens defined per sub-project. |
| Secrets/config | `.dev.vars` (gitignored) + `.dev.vars.example` committed; prod via `wrangler secret put`; non-secrets in wrangler `vars` | leerobert.ca pattern. |
| Versions | Node `>=22.12`, pnpm `11.5` (pinned), Go `1.24` (latest stable) | Matches leerobert.ca / current tooling. |

## Repository layout

```
voz.gg/
├── apps/                    # front-end projects
│   └── web/                 # Astro SSR + its Cloudflare Worker (site + /api)
│       ├── astro.config.mjs
│       ├── wrangler.jsonc
│       ├── project.json     # NX targets: build (astro build), deploy (wrangler deploy), dev
│       └── package.json
├── services/                # long-running microservices (Go daemons OR Cloudflare Workers)
│   ├── status-monitor/      # Go daemon stub: Minecraft ping reporter/API  (proves Go→physical deploy)
│   │   ├── main.go
│   │   └── project.json     # nx-go: build, serve, test, lint; deploy (per-server)
│   └── events-ingest/       # TS Cloudflare Worker stub  (proves Worker-microservice deploy to CF)
│       ├── src/index.ts
│       ├── wrangler.jsonc
│       └── project.json     # build, deploy (wrangler deploy)
├── tools/                   # CLI programs / batch utilities you invoke on demand
│   └── mc-logparser/        # Go CLI stub: `backfill` (one-shot) | `watch` (daemon)
│       ├── main.go
│       └── project.json
├── libs/                    # shared code (TS + Go)
│   ├── shared/              # TS: Drizzle D1 schema, zod schemas, shared types
│   │   ├── src/index.ts
│   │   └── project.json
│   └── go-logparse/         # Go: reusable log-parsing + event-reporting logic
│       └── project.json
├── nx.json
├── tsconfig.base.json       # TS path aliases for libs (e.g. @voz/shared → libs/shared/src)
├── go.mod                   # single root module: voz.gg
├── go.sum
├── pnpm-workspace.yaml
├── package.json             # root: nx + shared devDeps
├── CLAUDE.md                # → @AGENTS.md
└── AGENTS.md
```

### Categorization principle

Projects are categorized by **identity, not runtime mode**:
- **apps/** — front-ends.
- **services/** — processes whose only job is to run continuously (HTTP/RPC servers, persistent monitors). Polyglot: Go daemons *or* Cloudflare Workers.
- **tools/** — commands you invoke on demand. A long-running `watch`/daemon subcommand still belongs here — its identity is "a command."
- **libs/** — shared TS and Go code.

The log parser is split deliberately: reusable logic in `libs/go-logparse`, a thin binary in `tools/mc-logparser` exposing `backfill` and `watch` subcommands. This keeps logic testable and reusable by a future service without invoking the CLI.

### NX tags & module boundaries

Every project carries tags: `type:app | type:service | type:tool | type:lib` and `lang:ts | lang:go`. Enforced boundary rules (via `@nx/enforce-module-boundaries`):
- `libs` may not import from `apps`/`services`/`tools`.
- A `service` may not import another `service`'s internals.
- TS and Go boundaries are independent (no cross-language imports).

## Deploy model

- **`apps/web`** — `nx build web` → `astro build` (Cloudflare adapter output); `nx deploy web` → `wrangler deploy`. The Astro Worker also serves the site's own `/api/*` endpoints.
- **`services/events-ingest`** (TS Worker) — `nx deploy events-ingest` → `wrangler deploy`. A *separate* Worker from `apps/web`, proving standalone Worker-microservice deployment.
- **`services/status-monitor`, `tools/mc-logparser`** (Go) — nx-go `build` → binary; a per-project `deploy` target wraps physical-server delivery (ssh/rsync + systemd unit, or Docker). The spec fixes the *target name/convention*; exact mechanics are decided per service when it becomes real.
- **D1 migrations** — Drizzle generates SQL into `libs/shared`; applied via `wrangler d1 migrations apply` (wrapped in an NX target).

## Dev workflow

- `nx dev web` — Astro dev server (fast iteration, no Worker simulation).
- `nx run web:preview` — `wrangler dev` (full Worker + assets + D1 binding locally).
- `nx serve status-monitor` / `nx serve events-ingest` — run a service locally.
- `nx affected -t build,test,lint` — build/test only what changed.

## Documentation plan

- **`CLAUDE.md`** → single line importing `@AGENTS.md` (source-app pattern).
- **`AGENTS.md`** rewritten for the monorepo, covering: NX command cheatsheet, the apps/services/tools/libs structure + categorization principle, Cloudflare SSR deploy model, secrets convention, D1/Drizzle workflow, Go conventions (single module, tools-vs-services), and carried-over notes from the source app — the **Base UI hydration gotcha** (don't nest a Base-UI-derived component inside another primitive's `render` prop; style the outer with the inner's CVA classes), **Tailwind 4** (CSS-config, OKLch, no `tailwind.config`), and **React Compiler** guidance (avoid manual `useMemo`/`useCallback`).

## Foundation build — definition of done

The sub-project fed by this spec is complete when:

1. NX workspace + `@nx-go/nx-go` initialized; `apps/ services/ tools/ libs/` skeleton exists with tags + enforced boundaries.
2. `apps/web` is an Astro SSR scaffold that **builds and deploys to Cloudflare**, serving a placeholder page and a working `/api/health` endpoint that confirms the Worker runs and the D1 binding resolves.
3. `services/events-ingest` is a TS Cloudflare Worker that **deploys to Cloudflare** independently and responds on `/health`.
4. `services/status-monitor` (Go) and `tools/mc-logparser` (Go) build via nx-go and both import `libs/go-logparse`, proving the single-module polyglot layout. They run locally (stub behavior).
5. `libs/shared` exposes Drizzle wired to D1 with runnable migration tooling (schema may be minimal/empty).
6. Root `CLAUDE.md` + `AGENTS.md` written per the documentation plan.
7. No feature logic (auth, real schema, profiles, server CRUD, real ping/parsing) is implemented.
