# voz.gg

An NX polyglot monorepo: an Astro SSR frontend on Cloudflare Workers + D1, with Go
services/CLIs that run on physical servers.

- `apps/web` — Astro SSR site + Worker (Cloudflare)
- `services/events-ingest` — Cloudflare Worker (TS)
- `services/status-monitor` — Go daemon (physical server)
- `tools/mc-logparser` — Go CLI
- `libs/shared` (TS, `@voz/shared`) · `libs/go-shared` (Go)

See [AGENTS.md](AGENTS.md) for architecture, tags/boundaries, and tech notes.

## Prerequisites

- Node `>=22.12.0`, pnpm `11.5.0` (`corepack enable`)
- `pnpm install`
- Authenticated wrangler: `npx wrangler login` (once per machine)

## Develop

```bash
nx dev web                 # Astro dev server
nx run web:preview         # full Worker + assets + D1 locally (wrangler dev)
nx dev events-ingest       # events-ingest Worker locally
nx serve status-monitor    # Go service locally
```

Local D1 migrations: `nx run web:migrate:local`

## Deploy

There is no CI/CD — deploys are run manually from your machine.

### Deploy everything (Cloudflare)

```bash
pnpm deploy
```

This applies remote D1 migrations, then deploys every project that has a `deploy`
target (`web` and `events-ingest`) — each builds first automatically. Migrations
are idempotent; only un-applied ones run. Run this from a machine with wrangler
authenticated.

### Deploy one project

```bash
nx deploy web              # build + wrangler deploy (Astro SSR site)
nx deploy events-ingest    # wrangler deploy (events Worker)
```

`nx deploy` builds first via `dependsOn`, so no separate build step is needed.
These do **not** run migrations — use `pnpm deploy` or run `nx run web:migrate`
first if the schema changed.

### Database migrations (Cloudflare D1, `voz-gg`)

Schema and Drizzle client live in `libs/shared`; migration artifacts in
`apps/web/drizzle/migrations`.

```bash
nx run web:db:generate     # generate a migration after editing the schema
nx run web:migrate         # apply to prod  (wrangler ... --remote)
nx run web:migrate:local   # apply to local D1
```

### Secrets

Set once per environment, not part of deploy:

```bash
cd apps/web && npx wrangler secret put <NAME>
```

Locally, put secrets in `apps/web/.dev.vars` (gitignored). Non-secret config lives
in each project's `wrangler.jsonc` under `vars`.

### Go services (status-monitor, mc-logparser)

These run on physical servers, not Cloudflare, and have no `deploy` target. Build,
then copy the binary to the server with your own server tooling:

```bash
nx build status-monitor
```

They authenticate to the Worker APIs with a shared Bearer token.
