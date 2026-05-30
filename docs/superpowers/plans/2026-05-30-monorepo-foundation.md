# Monorepo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the voz.gg NX polyglot monorepo skeleton and prove the full deploy model — an Astro SSR app + a standalone Cloudflare Worker service + Go service/CLI binaries — all build and deploy from this repo, with no feature logic.

**Architecture:** NX (package-based, pnpm) + `@nx-go/nx-go` (single root `go.mod`, module path `voz.gg`). `apps/web` is Astro 6 SSR on the `@astrojs/cloudflare` adapter, bound to Cloudflare **D1** (schema/types in `libs/shared` via Drizzle). `services/` holds long-running microservices (one TS Worker `events-ingest`, one Go daemon stub `status-monitor`); `tools/` holds invokable CLIs (Go stub `mc-logparser`); `libs/` holds shared TS and Go code. NX **tags** + `@nx/enforce-module-boundaries` lock import direction.

**Tech Stack:** NX 22.x, `@nx-go/nx-go` 4.x, pnpm 11.5, Node ≥22.12, Go 1.24, Astro 6.x, `@astrojs/cloudflare` 13.x, Drizzle ORM 0.45.x + drizzle-kit (latest), Wrangler 4.x, Cloudflare D1.

---

## Notes for the implementer

- **Cloud actions:** Tasks 7 and 8 create real Cloudflare resources and deploy publicly. They require `wrangler login` (or `CLOUDFLARE_API_TOKEN`) against the user's account. **Confirm with the user before running any `wrangler d1 create`, `wrangler deploy`, or remote `migrations apply`.**
- **Fast-moving tooling — verify, don't assume:** Where a step is marked ⚠️VERIFY, the API/flag changed recently. Run the tool's `--help` or check the linked behavior if a command errors, and prefer the installed tool's actual output over this document.
- **Pragmatic deviations from the spec (intentional):** (1) `libs/go-shared` replaces `libs/go-logparse` for the foundation (see plan intro). (2) D1 migration *artifacts* live in `apps/web/drizzle/migrations` (the app that owns the deploy); schema/types/client live in `libs/shared` per the spec. (3) These are noted so review doesn't flag them as drift.
- **No feature logic.** Stubs only. Auth, real schema, profiles, server CRUD, real ping/parse logic are later sub-projects.

---

## File structure (what each task creates)

```
voz.gg/
├── nx.json                         # Task 2  — NX config, plugins, targetDefaults
├── package.json                    # Task 1  — root: nx + shared devDeps, engines, packageManager
├── pnpm-workspace.yaml             # Task 1  — workspace globs
├── tsconfig.base.json              # Task 1  — TS path aliases (@voz/shared)
├── go.mod                          # Task 2  — single root Go module `voz.gg`
├── eslint.config.mjs               # Task 12 — flat ESLint + enforce-module-boundaries
├── CLAUDE.md                       # Task 13 — → @AGENTS.md
├── AGENTS.md                       # Task 13 — monorepo guide
├── libs/
│   ├── shared/                     # Task 3  — TS data layer
│   │   ├── src/{index,schema,client,types}.ts
│   │   ├── project.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── go-shared/                  # Task 9  — Go shared lib (event types + report client)
│       ├── event.go, event_test.go, report.go
│       └── project.json
├── apps/
│   └── web/                        # Tasks 4–7 — Astro SSR + CF adapter + D1
│       ├── astro.config.mjs, wrangler.jsonc, drizzle.config.ts, tsconfig.json
│       ├── package.json, project.json, worker-configuration.d.ts
│       ├── drizzle/migrations/     # Task 6 — generated SQL
│       └── src/
│           ├── pages/index.astro            # prerendered placeholder
│           └── pages/api/health.ts          # SSR; queries D1
├── services/
│   ├── events-ingest/              # Task 8  — standalone TS Worker
│   │   ├── src/index.ts, wrangler.jsonc, package.json, project.json, tsconfig.json
│   └── status-monitor/             # Task 10 — Go daemon stub
│       ├── main.go, main_test.go, project.json
└── tools/
    └── mc-logparser/               # Task 11 — Go CLI stub (backfill|watch)
        ├── main.go, command.go, command_test.go, project.json
```

---

## Task 1: Workspace root skeleton

**Files:**
- Delete: root `src/`, `public/`, `astro.config.mjs`, `tsconfig.json`, `README.md`, `package.json`, `pnpm-lock.yaml`, `node_modules/`, `.vscode/` (fresh-starter leftovers; `docs/` and `.git/` stay)
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`

- [ ] **Step 1: Remove the fresh Astro starter (keep docs/ and git)**

```bash
cd /Users/voziv/dev/voz.gg
rm -rf src public astro.config.mjs tsconfig.json README.md package.json pnpm-lock.yaml node_modules .vscode
ls
```
Expected: `docs` remains; no `src`/`astro.config.mjs`/`package.json`.

- [ ] **Step 2: Create root `package.json`**

`/Users/voziv/dev/voz.gg/package.json`:
```json
{
  "name": "voz-gg",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "packageManager": "pnpm@11.5.0",
  "scripts": {
    "build": "nx run-many -t build",
    "test": "nx run-many -t test",
    "lint": "nx run-many -t lint"
  },
  "devDependencies": {}
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

`/Users/voziv/dev/voz.gg/pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'services/*'
  - 'tools/*'
  - 'libs/*'

# nx-go and Astro/Cloudflare native deps need their build scripts to run.
allowBuilds:
  esbuild: true
  sharp: true
  workerd: true
```

- [ ] **Step 4: Create `tsconfig.base.json`**

`/Users/voziv/dev/voz.gg/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@voz/shared": ["libs/shared/src/index.ts"]
    }
  }
}
```

- [ ] **Step 5: Create `.nvmrc`**

`/Users/voziv/dev/voz.gg/.nvmrc`:
```
22
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: reset to empty package-based monorepo skeleton"
```

---

## Task 2: Install NX + nx-go, initialize single Go module

**Files:**
- Create: `nx.json`, `go.mod`
- Modify: root `package.json` (devDeps added by installers)

- [ ] **Step 1: Install NX and the Go plugin**

```bash
cd /Users/voziv/dev/voz.gg
pnpm add -D -w nx@latest @nx/eslint@latest @nx-go/nx-go@latest
npx nx --version
```
Expected: prints NX local version `22.x` (⚠️VERIFY major; 22 current as of 2026-05).

- [ ] **Step 2: Create `nx.json`**

`/Users/voziv/dev/voz.gg/nx.json`:
```json
{
  "$schema": "node_modules/nx/schemas/nx-schema.json",
  "namedInputs": {
    "default": ["{projectRoot}/**/*"],
    "production": ["default"]
  },
  "targetDefaults": {
    "build": { "dependsOn": ["^build"], "cache": true },
    "test": { "cache": true },
    "lint": { "cache": true }
  },
  "workspaceLayout": { "appsDir": "apps", "libsDir": "libs" }
}
```

- [ ] **Step 3: Create the single root Go module**

`/Users/voziv/dev/voz.gg/go.mod`:
```
module voz.gg

go 1.24
```

- [ ] **Step 4: Initialize nx-go**

```bash
npx nx g @nx-go/nx-go:init --no-interactive
```
Expected: succeeds; may report Go found. ⚠️VERIFY: if it created a different go.mod, ensure the module line reads `module voz.gg`.

- [ ] **Step 5: Verify NX sees the workspace**

```bash
npx nx show projects
```
Expected: no projects yet (empty list) — no error. (Projects appear as later tasks add them.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: add nx and nx-go with single root go module"
```

---

## Task 3: `libs/shared` — TS data layer (Drizzle schema + client + types)

**Files:**
- Create: `libs/shared/package.json`, `libs/shared/tsconfig.json`, `libs/shared/project.json`, `libs/shared/src/{schema,client,types,index}.ts`

- [ ] **Step 1: Create the package manifest**

`/Users/voziv/dev/voz.gg/libs/shared/package.json`:
```json
{
  "name": "@voz/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "drizzle-orm": "^0.45.2",
    "zod": "^4.4.2"
  }
}
```

- [ ] **Step 2: Create `libs/shared/tsconfig.json`**

`/Users/voziv/dev/voz.gg/libs/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create the minimal schema (intentionally tiny; real tables arrive later)**

`/Users/voziv/dev/voz.gg/libs/shared/src/schema.ts`:
```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Placeholder table so migrations and the D1 binding can be exercised end to end.
// Real domain tables (users, servers, ...) are added in later sub-projects.
export const healthchecks = sqliteTable('healthchecks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  checkedAt: integer('checked_at', { mode: 'number' }).notNull(),
  note: text('note'),
});
```

- [ ] **Step 4: Create the Drizzle client helper**

`/Users/voziv/dev/voz.gg/libs/shared/src/client.ts`:
```typescript
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
```

- [ ] **Step 5: Create shared types**

`/Users/voziv/dev/voz.gg/libs/shared/src/types.ts`:
```typescript
export interface HealthResult {
  status: 'ok' | 'error';
  database: 'connected' | 'error';
  timestamp: string;
}
```

- [ ] **Step 6: Create the barrel export**

`/Users/voziv/dev/voz.gg/libs/shared/src/index.ts`:
```typescript
export * from './schema';
export * from './client';
export * from './types';
```

- [ ] **Step 7: Create the NX project config with tags**

`/Users/voziv/dev/voz.gg/libs/shared/project.json`:
```json
{
  "name": "shared",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "library",
  "sourceRoot": "libs/shared/src",
  "tags": ["type:lib", "lang:ts"],
  "targets": {
    "build": {
      "command": "tsc -p tsconfig.json --noEmit",
      "options": { "cwd": "libs/shared" }
    }
  }
}
```

- [ ] **Step 8: Install workspace deps and typecheck**

```bash
cd /Users/voziv/dev/voz.gg
pnpm install
npx nx build shared
```
Expected: `pnpm install` links `@voz/shared`; `nx build shared` runs `tsc --noEmit` with no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(shared): add d1 drizzle schema, client, and shared types"
```

---

## Task 4: `apps/web` — Astro SSR app on the Cloudflare adapter

**Files:**
- Create: `apps/web/package.json`, `apps/web/astro.config.mjs`, `apps/web/tsconfig.json`, `apps/web/wrangler.jsonc`, `apps/web/project.json`, `apps/web/src/pages/index.astro`

- [ ] **Step 1: Create the app manifest**

`/Users/voziv/dev/voz.gg/apps/web/package.json`:
```json
{
  "name": "@voz/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "wrangler dev"
  },
  "dependencies": {
    "@astrojs/cloudflare": "^13.5.0",
    "@voz/shared": "workspace:*",
    "astro": "^6.4.0",
    "drizzle-orm": "^0.45.2"
  },
  "devDependencies": {
    "wrangler": "^4.95.0"
  }
}
```

- [ ] **Step 2: Create `astro.config.mjs` (SSR by default, prerender per-route)**

`/Users/voziv/dev/voz.gg/apps/web/astro.config.mjs`:
```javascript
// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
});
```
⚠️VERIFY: Astro 6 + adapter 13 SSR API. If `output: 'server'` is rejected, the installed adapter may use the on-demand model — run `npx astro add cloudflare` in this dir and reconcile the generated config.

- [ ] **Step 3: Create `apps/web/tsconfig.json`**

`/Users/voziv/dev/voz.gg/apps/web/tsconfig.json`:
```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*", "worker-configuration.d.ts"],
  "exclude": ["dist"],
  "compilerOptions": {
    "baseUrl": "../..",
    "paths": { "@voz/shared": ["libs/shared/src/index.ts"] }
  }
}
```

- [ ] **Step 4: Create `wrangler.jsonc` (D1 binding placeholder; real id filled in Task 6)**

`/Users/voziv/dev/voz.gg/apps/web/wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "voz-gg-web",
  "compatibility_date": "2026-05-28",
  "compatibility_flags": ["nodejs_compat"],
  "main": "./dist/_worker.js/index.js",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "voz-gg",
      "database_id": "PLACEHOLDER_FILLED_IN_TASK_6",
      "migrations_dir": "./drizzle/migrations"
    }
  ],
  "observability": { "enabled": true }
}
```
⚠️VERIFY `main`/`assets.directory`: the adapter's output layout (`dist/_worker.js` vs a generated entry). After Task 5's build, confirm the real paths and adjust.

- [ ] **Step 5: Create the placeholder landing page (prerendered)**

`/Users/voziv/dev/voz.gg/apps/web/src/pages/index.astro`:
```astro
---
export const prerender = true;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <title>voz.gg</title>
  </head>
  <body>
    <main>
      <h1>voz.gg</h1>
      <p>Foundation placeholder. Landing page ports in a later sub-project.</p>
    </main>
  </body>
</html>
```

- [ ] **Step 6: Create the NX project config with tags**

`/Users/voziv/dev/voz.gg/apps/web/project.json`:
```json
{
  "name": "web",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "apps/web/src",
  "tags": ["type:app", "lang:ts"],
  "targets": {
    "dev": { "command": "astro dev", "options": { "cwd": "apps/web" } },
    "build": {
      "command": "astro build",
      "options": { "cwd": "apps/web" },
      "outputs": ["{projectRoot}/dist"]
    },
    "preview": { "command": "wrangler dev", "options": { "cwd": "apps/web" } },
    "deploy": {
      "command": "wrangler deploy",
      "options": { "cwd": "apps/web" },
      "dependsOn": ["build"]
    }
  }
}
```

- [ ] **Step 7: Install and build**

```bash
cd /Users/voziv/dev/voz.gg
pnpm install
npx nx build web
```
Expected: `astro build` completes, producing `apps/web/dist`. If `main`/`assets` paths in Step 4 don't match the real output, correct `wrangler.jsonc` now.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): scaffold astro ssr app on cloudflare adapter"
```

---

## Task 5: `/api/health` SSR endpoint querying D1

**Files:**
- Create: `apps/web/src/pages/api/health.ts`, `apps/web/worker-configuration.d.ts`

- [ ] **Step 1: Create the health endpoint**

`/Users/voziv/dev/voz.gg/apps/web/src/pages/api/health.ts`:
```typescript
import type { APIRoute } from 'astro';
import { createDb, healthchecks, type HealthResult } from '@voz/shared';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  // The Cloudflare adapter exposes bindings on locals.runtime.env.
  const env = (locals as any).runtime?.env as { DB: D1Database } | undefined;
  let database: HealthResult['database'] = 'error';
  try {
    if (env?.DB) {
      const db = createDb(env.DB);
      await db.select().from(healthchecks).limit(1).all();
      database = 'connected';
    }
  } catch {
    database = 'error';
  }
  const body: HealthResult = {
    status: database === 'connected' ? 'ok' : 'error',
    database,
    timestamp: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), {
    status: database === 'connected' ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
};
```
⚠️VERIFY env access: this uses `locals.runtime.env` (adapter convention). If the installed adapter instead requires `import { env } from 'cloudflare:workers'`, switch to that — it is import-safe here because this route is `prerender = false`. Confirm against the adapter version before Task 6.

- [ ] **Step 2: Generate Cloudflare binding types**

```bash
cd /Users/voziv/dev/voz.gg/apps/web
npx wrangler types
ls worker-configuration.d.ts
```
Expected: generates `worker-configuration.d.ts` typing `DB: D1Database`, `ASSETS`. ⚠️VERIFY output filename; adjust the tsconfig `include` if it differs.

- [ ] **Step 3: Build to confirm it compiles**

```bash
cd /Users/voziv/dev/voz.gg
npx nx build web
```
Expected: build succeeds (endpoint is SSR, not prerendered, so no binding access at build time).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add /api/health endpoint querying d1"
```

---

## Task 6: D1 database + Drizzle migrations (local), verify health locally

**Files:**
- Create: `apps/web/drizzle.config.ts`, `apps/web/drizzle/migrations/*` (generated)
- Modify: `apps/web/wrangler.jsonc` (real `database_id`)

> **Cloud note:** `wrangler d1 create` registers a database on the user's Cloudflare account. Confirm before running.

- [ ] **Step 1: Create the Drizzle config (generate-only; schema sourced from libs/shared)**

`/Users/voziv/dev/voz.gg/apps/web/drizzle.config.ts`:
```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: '../../libs/shared/src/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
});
```

- [ ] **Step 2: Add drizzle-kit to the app and generate the first migration**

```bash
cd /Users/voziv/dev/voz.gg/apps/web
pnpm add -D drizzle-kit
npx drizzle-kit generate
ls drizzle/migrations
```
Expected: a `0000_*.sql` migration creating the `healthchecks` table.

- [ ] **Step 3: Create the D1 database (CLOUD — confirm first)**

```bash
cd /Users/voziv/dev/voz.gg/apps/web
npx wrangler d1 create voz-gg
```
Expected: prints a `database_id`. Copy it into `wrangler.jsonc` Step-4 placeholder.

- [ ] **Step 4: Apply migrations to the LOCAL D1**

```bash
cd /Users/voziv/dev/voz.gg/apps/web
npx wrangler d1 migrations apply voz-gg --local
```
Expected: applies `0000_*.sql` to the local SQLite under `.wrangler/`.

- [ ] **Step 5: Run locally and hit the health endpoint**

```bash
cd /Users/voziv/dev/voz.gg
npx nx build web
cd apps/web && npx wrangler dev &
sleep 4
curl -s http://localhost:8787/api/health
```
Expected JSON: `{"status":"ok","database":"connected","timestamp":"..."}`. Stop the dev server (`kill %1`) when done.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): wire d1 database with drizzle migrations"
```

---

## Task 7: Deploy `apps/web` to Cloudflare (CLOUD), verify live

> **Cloud note:** Public deploy + remote DB writes. Confirm with the user. Requires `wrangler login`.

- [ ] **Step 1: Apply migrations to REMOTE D1**

```bash
cd /Users/voziv/dev/voz.gg/apps/web
npx wrangler d1 migrations apply voz-gg --remote
```
Expected: applies `0000_*.sql` to the production D1.

- [ ] **Step 2: Deploy**

```bash
cd /Users/voziv/dev/voz.gg
npx nx deploy web
```
Expected: `wrangler deploy` uploads the Worker + assets; prints the `*.workers.dev` URL.

- [ ] **Step 3: Verify the live health endpoint**

```bash
curl -s https://voz-gg-web.<account-subdomain>.workers.dev/api/health
```
Expected JSON: `{"status":"ok","database":"connected",...}`. (Substitute the URL printed in Step 2.)

- [ ] **Step 4: Commit (no code change; record the verified deploy)**

```bash
git commit --allow-empty -m "chore(web): verify cloudflare deploy with live d1 health check"
```

---

## Task 8: `services/events-ingest` — standalone TS Cloudflare Worker

**Files:**
- Create: `services/events-ingest/{package.json,wrangler.jsonc,tsconfig.json,project.json}`, `services/events-ingest/src/index.ts`

- [ ] **Step 1: Create the worker source**

`/Users/voziv/dev/voz.gg/services/events-ingest/src/index.ts`:
```typescript
interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      let database = 'error';
      try {
        await env.DB.prepare('SELECT 1').first();
        database = 'connected';
      } catch {
        database = 'error';
      }
      return Response.json({ service: 'events-ingest', status: 'ok', database });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: Create `package.json`**

`/Users/voziv/dev/voz.gg/services/events-ingest/package.json`:
```json
{
  "name": "@voz/events-ingest",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": { "dev": "wrangler dev", "deploy": "wrangler deploy" },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250529.0",
    "typescript": "^5.4.5",
    "wrangler": "^4.95.0"
  }
}
```

- [ ] **Step 3: Create `wrangler.jsonc` (binds the same D1 as web)**

`/Users/voziv/dev/voz.gg/services/events-ingest/wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "voz-gg-events-ingest",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-28",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "voz-gg",
      "database_id": "SAME_ID_AS_apps_web_wrangler"
    }
  ],
  "observability": { "enabled": true }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

`/Users/voziv/dev/voz.gg/services/events-ingest/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types"] },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 5: Create `project.json` with tags**

`/Users/voziv/dev/voz.gg/services/events-ingest/project.json`:
```json
{
  "name": "events-ingest",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "services/events-ingest/src",
  "tags": ["type:service", "lang:ts"],
  "targets": {
    "build": {
      "command": "tsc -p tsconfig.json --noEmit",
      "options": { "cwd": "services/events-ingest" }
    },
    "dev": { "command": "wrangler dev", "options": { "cwd": "services/events-ingest" } },
    "deploy": { "command": "wrangler deploy", "options": { "cwd": "services/events-ingest" } }
  }
}
```

- [ ] **Step 6: Install, typecheck, and run locally**

```bash
cd /Users/voziv/dev/voz.gg
pnpm install
npx nx build events-ingest
cd services/events-ingest && npx wrangler dev &
sleep 4
curl -s http://localhost:8787/health
kill %1
```
Expected JSON: `{"service":"events-ingest","status":"ok","database":"connected"}`.

- [ ] **Step 7: Deploy (CLOUD — confirm first)**

```bash
cd /Users/voziv/dev/voz.gg
npx nx deploy events-ingest
curl -s https://voz-gg-events-ingest.<account-subdomain>.workers.dev/health
```
Expected: live JSON as above.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(events-ingest): add standalone cloudflare worker service"
```

---

## Task 9: `libs/go-shared` — shared Go library (TDD)

**Files:**
- Create: `libs/go-shared/event.go`, `libs/go-shared/event_test.go`, `libs/go-shared/report.go`, `libs/go-shared/project.json`

- [ ] **Step 1: Write the failing test**

`/Users/voziv/dev/voz.gg/libs/go-shared/event_test.go`:
```go
package goshared

import "testing"

func TestNewEventSetsType(t *testing.T) {
	e := NewEvent(EventPlayerJoin, "alice")
	if e.Type != EventPlayerJoin {
		t.Fatalf("got type %q, want %q", e.Type, EventPlayerJoin)
	}
	if e.Subject != "alice" {
		t.Fatalf("got subject %q, want %q", e.Subject, "alice")
	}
}
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/voziv/dev/voz.gg
go test ./libs/go-shared/
```
Expected: FAIL — `undefined: NewEvent` / `EventPlayerJoin` / `Event`.

- [ ] **Step 3: Implement the minimal event type**

`/Users/voziv/dev/voz.gg/libs/go-shared/event.go`:
```go
// Package goshared holds types and helpers shared by voz.gg Go services and tools.
package goshared

type EventType string

const (
	EventPlayerJoin  EventType = "player_join"
	EventPlayerLeave EventType = "player_leave"
)

type Event struct {
	Type    EventType `json:"type"`
	Subject string    `json:"subject"`
}

func NewEvent(t EventType, subject string) Event {
	return Event{Type: t, Subject: subject}
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /Users/voziv/dev/voz.gg
go test ./libs/go-shared/
```
Expected: PASS — `ok  voz.gg/libs/go-shared`.

- [ ] **Step 5: Add the report client (no network in the stub; just builds the request)**

`/Users/voziv/dev/voz.gg/libs/go-shared/report.go`:
```go
package goshared

import (
	"bytes"
	"encoding/json"
	"net/http"
)

// Reporter posts events to a voz.gg Worker endpoint using a shared bearer token.
type Reporter struct {
	Endpoint string
	Token    string
	Client   *http.Client
}

func (r Reporter) buildRequest(e Event) (*http.Request, error) {
	body, err := json.Marshal(e)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, r.Endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+r.Token)
	return req, nil
}
```

- [ ] **Step 6: Create the NX project config with tags**

`/Users/voziv/dev/voz.gg/libs/go-shared/project.json`:
```json
{
  "name": "go-shared",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "library",
  "sourceRoot": "libs/go-shared",
  "tags": ["type:lib", "lang:go"],
  "targets": {
    "test": { "executor": "@nx-go/nx-go:test" },
    "lint": { "executor": "@nx-go/nx-go:lint" }
  }
}
```

- [ ] **Step 7: Run via NX to confirm the executor works**

```bash
cd /Users/voziv/dev/voz.gg
npx nx test go-shared
```
Expected: PASS. ⚠️VERIFY: if nx-go's test executor needs the project registered, run `npx nx show projects` and confirm `go-shared` appears.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(go-shared): add shared event type and reporter client"
```

---

## Task 10: `services/status-monitor` — Go daemon stub (imports go-shared)

**Files:**
- Create: `services/status-monitor/main.go`, `services/status-monitor/main_test.go`, `services/status-monitor/project.json`

- [ ] **Step 1: Write the failing test (proves it builds the shared event)**

`/Users/voziv/dev/voz.gg/services/status-monitor/main_test.go`:
```go
package main

import (
	"testing"

	goshared "voz.gg/libs/go-shared"
)

func TestStatusEventUsesSharedLib(t *testing.T) {
	e := statusEvent("mc.example.com")
	if e.Type != goshared.EventPlayerJoin {
		// The stub reuses an existing event type purely to exercise the import.
		t.Fatalf("unexpected event type %q", e.Type)
	}
	if e.Subject != "mc.example.com" {
		t.Fatalf("got subject %q, want host", e.Subject)
	}
}
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/voziv/dev/voz.gg
go test ./services/status-monitor/
```
Expected: FAIL — `undefined: statusEvent`.

- [ ] **Step 3: Implement the daemon stub**

`/Users/voziv/dev/voz.gg/services/status-monitor/main.go`:
```go
// Command status-monitor is a stub for the Minecraft server status reporter.
// Real ping logic arrives in the server-status-monitoring sub-project.
package main

import (
	"fmt"

	goshared "voz.gg/libs/go-shared"
)

func statusEvent(host string) goshared.Event {
	return goshared.NewEvent(goshared.EventPlayerJoin, host)
}

func main() {
	fmt.Println("status-monitor stub: daemon would poll game servers here")
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /Users/voziv/dev/voz.gg
go test ./services/status-monitor/
```
Expected: PASS — `ok  voz.gg/services/status-monitor`.

- [ ] **Step 5: Create the NX project config with tags**

`/Users/voziv/dev/voz.gg/services/status-monitor/project.json`:
```json
{
  "name": "status-monitor",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "services/status-monitor",
  "tags": ["type:service", "lang:go"],
  "targets": {
    "build": { "executor": "@nx-go/nx-go:build" },
    "serve": { "executor": "@nx-go/nx-go:serve" },
    "test": { "executor": "@nx-go/nx-go:test" },
    "lint": { "executor": "@nx-go/nx-go:lint" }
  }
}
```

- [ ] **Step 6: Build and run via NX**

```bash
cd /Users/voziv/dev/voz.gg
npx nx build status-monitor
npx nx serve status-monitor
```
Expected: builds a binary; serve prints `status-monitor stub: daemon would poll game servers here`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(status-monitor): add go daemon stub importing go-shared"
```

---

## Task 11: `tools/mc-logparser` — Go CLI stub with `backfill`|`watch` (TDD)

**Files:**
- Create: `tools/mc-logparser/command.go`, `tools/mc-logparser/command_test.go`, `tools/mc-logparser/main.go`, `tools/mc-logparser/project.json`

- [ ] **Step 1: Write the failing test for subcommand dispatch**

`/Users/voziv/dev/voz.gg/tools/mc-logparser/command_test.go`:
```go
package main

import "testing"

func TestResolveCommand(t *testing.T) {
	cases := map[string]struct {
		args    []string
		want    string
		wantErr bool
	}{
		"backfill": {args: []string{"backfill"}, want: "backfill"},
		"watch":    {args: []string{"watch"}, want: "watch"},
		"none":     {args: []string{}, wantErr: true},
		"unknown":  {args: []string{"frobnicate"}, wantErr: true},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := resolveCommand(c.args)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error, got command %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/voziv/dev/voz.gg
go test ./tools/mc-logparser/
```
Expected: FAIL — `undefined: resolveCommand`.

- [ ] **Step 3: Implement command resolution**

`/Users/voziv/dev/voz.gg/tools/mc-logparser/command.go`:
```go
package main

import "fmt"

// resolveCommand validates the first CLI argument against the supported
// subcommands. backfill = one-shot history scan; watch = long-running daemon.
func resolveCommand(args []string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("usage: mc-logparser <backfill|watch>")
	}
	switch args[0] {
	case "backfill", "watch":
		return args[0], nil
	default:
		return "", fmt.Errorf("unknown command %q (want backfill or watch)", args[0])
	}
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /Users/voziv/dev/voz.gg
go test ./tools/mc-logparser/
```
Expected: PASS — `ok  voz.gg/tools/mc-logparser`.

- [ ] **Step 5: Implement main wiring (uses go-shared to prove the import)**

`/Users/voziv/dev/voz.gg/tools/mc-logparser/main.go`:
```go
// Command mc-logparser is a stub CLI for the Minecraft log parser.
// `backfill` scans history once; `watch` tails the log as a daemon.
// Real parsing arrives in the log-parser sub-project.
package main

import (
	"fmt"
	"os"

	goshared "voz.gg/libs/go-shared"
)

func main() {
	cmd, err := resolveCommand(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	// Demonstrates the shared lib is importable from a tool in the same module.
	_ = goshared.NewEvent(goshared.EventPlayerJoin, "stub")
	fmt.Printf("mc-logparser stub: would run %q\n", cmd)
}
```

- [ ] **Step 6: Create the NX project config with tags**

`/Users/voziv/dev/voz.gg/tools/mc-logparser/project.json`:
```json
{
  "name": "mc-logparser",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "tools/mc-logparser",
  "tags": ["type:tool", "lang:go"],
  "targets": {
    "build": { "executor": "@nx-go/nx-go:build" },
    "serve": { "executor": "@nx-go/nx-go:serve" },
    "test": { "executor": "@nx-go/nx-go:test" },
    "lint": { "executor": "@nx-go/nx-go:lint" }
  }
}
```

- [ ] **Step 7: Build and run both subcommands**

```bash
cd /Users/voziv/dev/voz.gg
npx nx build mc-logparser
npx nx serve mc-logparser --args="backfill"
npx nx serve mc-logparser --args="watch"
```
Expected: prints `mc-logparser stub: would run "backfill"` then `... "watch"`. ⚠️VERIFY arg passing: if `--args` isn't honored by the serve executor, run the built binary directly (`./dist/... backfill`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(mc-logparser): add go cli stub with backfill and watch commands"
```

---

## Task 12: ESLint module boundaries (tags enforcement)

**Files:**
- Create: `eslint.config.mjs`

- [ ] **Step 1: Create the flat ESLint config with boundary constraints**

`/Users/voziv/dev/voz.gg/eslint.config.mjs`:
```javascript
import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependencies: true,
          depConstraints: [
            { sourceTag: 'type:lib', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:service', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:tool', onlyDependOnLibsWithTags: ['type:lib'] },
          ],
        },
      ],
    },
  },
];
```

- [ ] **Step 2: Install the ESLint plugin**

```bash
cd /Users/voziv/dev/voz.gg
pnpm add -D -w @nx/eslint-plugin@latest eslint@latest
```

- [ ] **Step 3: Lint the TS projects — expect clean**

```bash
npx nx run-many -t lint --projects=web,shared,events-ingest
```
Expected: PASS. `web` imports only `@voz/shared` (a `type:lib`), which the constraints allow. ⚠️VERIFY: if nx-go projects error on the TS ESLint config, scope lint to TS projects only (as above) — Go lint runs via the nx-go executor in Task 14.

- [ ] **Step 4: Prove the boundary fails on a violation (then revert)**

```bash
cd /Users/voziv/dev/voz.gg
# Temporarily make the lib import an app to confirm the rule fires.
printf "\n// boundary probe\nimport '@voz/web';\n" >> libs/shared/src/index.ts
npx nx lint shared || echo "BOUNDARY RULE FIRED (expected)"
git checkout -- libs/shared/src/index.ts
```
Expected: lint errors with an `enforce-module-boundaries` violation, then the file is reverted.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: enforce nx module boundaries via tags"
```

---

## Task 13: Documentation (`CLAUDE.md`, `AGENTS.md`)

**Files:**
- Create: `CLAUDE.md`, `AGENTS.md`

- [ ] **Step 1: Create `CLAUDE.md` (points to AGENTS.md, source-app pattern)**

`/Users/voziv/dev/voz.gg/CLAUDE.md`:
```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Make updates to AGENTS.md instead of CLAUDE.md

@AGENTS.md
```

- [ ] **Step 2: Create `AGENTS.md`**

`/Users/voziv/dev/voz.gg/AGENTS.md`:
```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: add CLAUDE.md and monorepo AGENTS.md"
```

---

## Task 14: Final full-workspace verification

- [ ] **Step 1: Build, test, and lint everything**

```bash
cd /Users/voziv/dev/voz.gg
npx nx run-many -t build
npx nx run-many -t test
go test ./...
npx nx run-many -t lint --projects=web,shared,events-ingest
```
Expected: all green. `go test ./...` covers `go-shared`, `status-monitor`, `mc-logparser`.

- [ ] **Step 2: Inspect the project graph**

```bash
npx nx show projects
```
Expected list: `web`, `shared`, `events-ingest`, `status-monitor`, `mc-logparser`, `go-shared`.

- [ ] **Step 3: Confirm the definition of done (from the spec)**

Verify each holds:
1. NX + nx-go initialized; `apps/ services/ tools/ libs/` exist with tags + enforced boundaries (Tasks 2, 12).
2. `apps/web` builds and deploys to Cloudflare; `/api/health` confirms Worker + D1 (Tasks 4–7).
3. `services/events-ingest` deploys independently, responds on `/health` (Task 8).
4. `status-monitor` (Go) and `mc-logparser` (Go) build via nx-go and both import `libs/go-shared` in one module (Tasks 9–11).
5. `libs/shared` exposes Drizzle wired to D1 with runnable migrations (Tasks 3, 6).
6. `CLAUDE.md` + `AGENTS.md` written (Task 13).
7. No feature logic implemented.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit --allow-empty -m "chore: foundation build complete — verified build/test/lint and deploys"
```

---

## Self-review notes (author)

- **Spec coverage:** every Decision-table row and all 7 definition-of-done items map to tasks (cross-referenced in Task 14 Step 3). Tags/boundaries (Task 12), D1/Drizzle (3,6), SSR adapter (4), both microservice flavors (7,8), Go single-module + shared lib (9–11), docs (13).
- **Known fragile points (flagged inline as ⚠️VERIFY):** NX major version; nx-go module default vs single-root; the `@astrojs/cloudflare` SSR output API + `wrangler.jsonc` `main`/`assets` paths; Astro 6 env-access (`locals.runtime.env` vs `cloudflare:workers`); `wrangler types` output filename; nx-go `serve --args` passing.
- **Intentional deviations from spec:** `libs/go-shared` (not `go-logparse`); migration artifacts in `apps/web` (schema still in `libs/shared`). Both noted at top.
```
