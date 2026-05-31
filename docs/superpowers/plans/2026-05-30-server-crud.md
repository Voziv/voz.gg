# Admin Server CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins create, edit, and delete servers from the existing `/dashboard/servers` page, gated on the better-auth `role`.

**Architecture:** Three Next.js server actions from the source become Astro SSR API routes (`POST /api/servers`, `PUT`/`DELETE /api/servers/:id`) that check `role === 'admin'`, validate with a shared zod schema, and write to D1 via Drizzle. A ported Base UI `dialog` primitive backs a `ServerFormDialog` island (create/edit) and a `DeleteServerButton` island; both POST/PUT/DELETE JSON and `location.reload()` on success. The servers page gains admin-only controls.

**Tech Stack:** Astro 6 SSR (`@astrojs/cloudflare`), `@astrojs/react` islands, Base UI (`@base-ui/react`) + shadcn `base-vega`, `zod`, `nanoid`, Drizzle/D1, Vitest.

**Key facts (verified against the codebase / #3 / #4):**
- The `servers` table + `GameType` + `GAME_TYPES` already exist in `libs/shared/src/schema.ts` (exported via `@voz/shared`). **No schema or migration change in #5.** Columns: `id, name, gameType, host, port, description, createdBy (FK user.id), createdAt, updatedAt` (timestamps are `{ mode: 'timestamp' }` → JS `Date`).
- Env is read via **`import { env } from 'cloudflare:workers'`**; D1 binding is **`env.DB`**; `createDb(env.DB)` returns the Drizzle client. `eq` comes from `drizzle-orm`.
- `Astro.locals.user` is set by `apps/web/src/middleware.ts`; `/dashboard/*` and `/api/*` (except `/api/auth/*`) are already protected (unauth → `/sign-in`). The better-auth **admin plugin** is enabled in `apps/web/src/lib/auth.ts`, so `locals.user.role` exists (`'user'` default).
- The base-vega primitives `button` (exports `Button` + `buttonVariants`, includes a `size: 'icon'` and `size: 'icon-sm'` variant), `card`, `input`, `label`, `sonner` (`Toaster`) exist under `apps/web/src/components/ui/`. `cn` is at `apps/web/src/lib/utils.ts`.
- Vitest runs via `npx nx test web` (`vitest run --passWithNoTests`, includes `src/**/*.test.ts`).
- The #4 islands (e.g. `SteamLinkCard`) call `location.reload()` after a server mutation — reuse that pattern.
- **Base UI hydration gotcha (AGENTS.md):** never put a Base-UI-derived component (`Button`) inside another primitive's `render` prop. The source `dialog.tsx` violates this in its close buttons; Task 6 fixes it. The dialog trigger is styled with `buttonVariants` directly.

**Commit signing:** the repo signs commits via SSH/1Password, which may be intermittently unavailable. Try a normal `git commit`; if it fails with a 1Password/signing error, retry the SAME commit once as `git -c commit.gpgsign=false commit -m "..."` (per-command only — never change persistent git config).

**TDD note:** the zod schema and the `isAdmin` guard are pure → strict TDD. Routes and islands are integration-heavy (need a session + admin role) → build/lint verification, with the runtime smoke deferred to Task 10 / real creds.

---

## File structure

| path | responsibility |
|------|----------------|
| `apps/web/src/lib/server-schema.ts` (+ `.test.ts`) | zod schema + `parseServerInput(raw)` helper (pure, TDD) |
| `apps/web/src/lib/admin.ts` (+ `.test.ts`) | `isAdmin(user)` role guard (pure, TDD) |
| `apps/web/src/pages/api/servers/index.ts` | `POST` create (admin-gated) |
| `apps/web/src/pages/api/servers/[id].ts` | `PUT` update / `DELETE` delete (admin-gated) |
| `apps/web/src/components/ui/dialog.tsx` | base-vega dialog primitive (Base UI; gotcha fixed) |
| `apps/web/src/components/dashboard/ServerFormDialog.tsx` | island — create/edit form |
| `apps/web/src/components/dashboard/DeleteServerButton.tsx` | island — delete with confirm |
| `apps/web/src/pages/dashboard/servers.astro` | + admin Add/Edit/Delete controls |
| `apps/web/package.json` | + `zod`, `nanoid` |

---

## Task 1: Add `zod` + `nanoid` dependencies

**Files:** Modify `apps/web/package.json`

- [ ] **Step 1: Install**

```bash
pnpm add --filter @voz/web zod nanoid
```
(If `@voz/web` is not the package name, check `apps/web/package.json`'s `name` field and use that, or `pnpm --filter ./apps/web add zod nanoid`.)

- [ ] **Step 2: Verify the deps landed in `apps/web/package.json` (not the root)**

Run: `node -e "const p=require('./apps/web/package.json'); console.log(p.dependencies.zod, p.dependencies.nanoid)"`
Expected: two version strings (not `undefined`).

- [ ] **Step 3: Build**

Run: `npx nx build web`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add zod and nanoid deps"
```

---

## Task 2: zod server schema + parse helper (TDD)

**Files:**
- Create: `apps/web/src/lib/server-schema.ts`
- Test: `apps/web/src/lib/server-schema.test.ts`

- [ ] **Step 1: Write the failing test — `apps/web/src/lib/server-schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseServerInput } from './server-schema';

const valid = {
  name: 'Survival',
  gameType: 'minecraft-java',
  host: 'mc.example.com',
  port: '25565',
  description: '  Friendly SMP  ',
};

describe('parseServerInput', () => {
  it('accepts valid input, coerces the port, and trims the description', () => {
    const r = parseServerInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        name: 'Survival',
        gameType: 'minecraft-java',
        host: 'mc.example.com',
        port: 25565,
        description: 'Friendly SMP',
      });
    }
  });

  it('turns a blank description into null', () => {
    const r = parseServerInput({ ...valid, description: '   ' });
    expect(r.ok && r.data.description).toBeNull();
  });

  it('omits description entirely → null', () => {
    const { description: _omit, ...noDesc } = valid;
    const r = parseServerInput(noDesc);
    expect(r.ok && r.data.description).toBeNull();
  });

  it('rejects an empty name', () => {
    const r = parseServerInput({ ...valid, name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name is required/i);
  });

  it('rejects a name over 80 chars', () => {
    expect(parseServerInput({ ...valid, name: 'a'.repeat(81) }).ok).toBe(false);
  });

  it('rejects an unknown game type', () => {
    expect(parseServerInput({ ...valid, gameType: 'fortnite' }).ok).toBe(false);
  });

  it('rejects a host with illegal characters', () => {
    const r = parseServerInput({ ...valid, host: 'bad host!' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid host/i);
  });

  it.each(['0', '70000', '12.5', 'abc'])('rejects port %s', (port) => {
    expect(parseServerInput({ ...valid, port }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test web`
Expected: FAIL — `Cannot find module './server-schema'`.

- [ ] **Step 3: Implement `apps/web/src/lib/server-schema.ts`**

```ts
import { z } from 'zod';
import { GAME_TYPES } from '@voz/shared';

const serverSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  gameType: z.enum(GAME_TYPES),
  host: z
    .string()
    .trim()
    .min(1, 'Host is required.')
    .max(253)
    .regex(/^[A-Za-z0-9.\-_:]+$/, 'Invalid host.'),
  port: z.coerce.number().int().min(1).max(65535),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type ServerInput = z.infer<typeof serverSchema>;

export type ParseResult =
  | { ok: true; data: ServerInput }
  | { ok: false; error: string };

export function parseServerInput(raw: unknown): ParseResult {
  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  return { ok: true, data: parsed.data };
}
```

(If TypeScript/zod rejects `z.enum(GAME_TYPES)` because `GAME_TYPES` is a `readonly` tuple, spread it: `z.enum([...GAME_TYPES] as [string, ...string[]])` — but try the direct form first; the source uses it as-is.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test web`
Expected: PASS (all `parseServerInput` cases green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server-schema.ts apps/web/src/lib/server-schema.test.ts
git commit -m "feat(web): add zod server schema and parse helper (tdd)"
```

---

## Task 3: `isAdmin` guard (TDD)

**Files:**
- Create: `apps/web/src/lib/admin.ts`
- Test: `apps/web/src/lib/admin.test.ts`

- [ ] **Step 1: Write the failing test — `apps/web/src/lib/admin.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isAdmin } from './admin';

describe('isAdmin', () => {
  it('is true only for role "admin"', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
  });
  it('is false for a normal user', () => {
    expect(isAdmin({ role: 'user' })).toBe(false);
  });
  it('is false when role is missing/null', () => {
    expect(isAdmin({})).toBe(false);
    expect(isAdmin({ role: null })).toBe(false);
  });
  it('is false for null/undefined', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test web`
Expected: FAIL — `Cannot find module './admin'`.

- [ ] **Step 3: Implement `apps/web/src/lib/admin.ts`**

```ts
// Accepts the structural shape of Astro.locals.user (or null/undefined).
export function isAdmin(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === 'admin';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/admin.ts apps/web/src/lib/admin.test.ts
git commit -m "feat(web): add isAdmin role guard (tdd)"
```

---

## Task 4: `POST /api/servers` — create (admin)

**Files:** Create `apps/web/src/pages/api/servers/index.ts`

- [ ] **Step 1: Implement the route**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { nanoid } from 'nanoid';
import { createDb, servers } from '@voz/shared';
import { isAdmin } from '../../../lib/admin';
import { parseServerInput } from '../../../lib/server-schema';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const parsed = parseServerInput(await ctx.request.json().catch(() => ({})));
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const db = createDb(env.DB);
  const id = nanoid(12);
  const now = new Date();
  await db.insert(servers).values({
    id,
    name: parsed.data.name,
    gameType: parsed.data.gameType,
    host: parsed.data.host,
    port: parsed.data.port,
    description: parsed.data.description,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  });
  return Response.json({ ok: true, id });
};
```

- [ ] **Step 2: Build**

Run: `npx nx build web`
Expected: succeeds. (If `ctx.locals.user.id`/`.role` don't typecheck, confirm the `App.Locals` user type in `apps/web/src/env.d.ts` — it is better-auth's inferred session user, which has `id` and `role`. Do not invent a new shape.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/api/servers/index.ts
git commit -m "feat(web): add create-server api route (admin)"
```

---

## Task 5: `PUT`/`DELETE /api/servers/[id]` — update + delete (admin)

**Files:** Create `apps/web/src/pages/api/servers/[id].ts`

- [ ] **Step 1: Implement the route**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, servers } from '@voz/shared';
import { isAdmin } from '../../../lib/admin';
import { parseServerInput } from '../../../lib/server-schema';

export const prerender = false;

export const PUT: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const id = ctx.params.id!;
  const parsed = parseServerInput(await ctx.request.json().catch(() => ({})));
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const db = createDb(env.DB);
  const existing = await db.select().from(servers).where(eq(servers.id, id)).get();
  if (!existing) return Response.json({ ok: false, error: 'Server not found.' }, { status: 404 });

  await db
    .update(servers)
    .set({
      name: parsed.data.name,
      gameType: parsed.data.gameType,
      host: parsed.data.host,
      port: parsed.data.port,
      description: parsed.data.description,
      updatedAt: new Date(),
    })
    .where(eq(servers.id, id));
  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const db = createDb(env.DB);
  await db.delete(servers).where(eq(servers.id, ctx.params.id!));
  return Response.json({ ok: true }); // idempotent — ok even if the row was already gone
};
```

- [ ] **Step 2: Build**

Run: `npx nx build web`
Expected: succeeds. (`db.select()...get()` is the Drizzle/D1 single-row accessor; it returns `undefined` when no row matches.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/api/servers/[id].ts
git commit -m "feat(web): add update/delete-server api route (admin)"
```

---

## Task 6: Port the `dialog` primitive (Base UI) — with the hydration gotcha fixed

**Files:** Create `apps/web/src/components/ui/dialog.tsx`

Port `~/dev/game-server-panel/src/components/ui/dialog.tsx` with these changes:
- `import { cn } from "@/lib/utils"` → `import { cn } from "../../lib/utils"`.
- Replace `import { Button } from "@/components/ui/button"` → `import { buttonVariants } from "./button"`.
- Keep `import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"` and the `lucide-react` `XIcon` import.
- **Fix the two hydration-gotcha close buttons** (the source nests `<Button>` in a `render` prop — forbidden by AGENTS.md). Style the `Close` primitive directly with `buttonVariants` instead.

- [ ] **Step 1: Create `apps/web/src/components/ui/dialog.tsx`**

```tsx
'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { buttonVariants } from './button';

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'absolute top-4 right-4')}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />;
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close className={cn(buttonVariants({ variant: 'outline' }))}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-heading leading-none font-medium', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
```

- [ ] **Step 2: Confirm no `render={<Button` / `next-themes` slipped in, and `buttonVariants` supports the sizes used**

Run: `grep -n "render={<Button" apps/web/src/components/ui/dialog.tsx || echo "clean"`
Expected: `clean`.
Run: `grep -n "icon-sm" apps/web/src/components/ui/button.tsx`
Expected: a match (the `icon-sm` size exists). If it does NOT, use `size: 'icon'` instead in `DialogContent`'s close button.

- [ ] **Step 3: Build**

Run: `npx nx build web`
Expected: succeeds (the primitive compiles; it is not mounted yet). The `bg-popover` / `text-muted-foreground` tokens come from the OKLch theme already in `global.css`; `ServerFormDialog` (next task) overrides the popup background/text anyway.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/dialog.tsx
git commit -m "feat(web): port base-vega dialog primitive (fix render-prop hydration gotcha)"
```

---

## Task 7: `ServerFormDialog` island (create/edit)

**Files:** Create `apps/web/src/components/dashboard/ServerFormDialog.tsx`

Ports the source dialog, converting the server-action submit to a JSON `fetch`. The trigger is styled directly with `buttonVariants` (no nested `Button` in a `render` prop). Because Astro islands can't take arbitrary JSX children, the trigger content is rendered internally based on whether `server` is provided (edit vs create).

- [ ] **Step 1: Create the island**

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';
import { GAME_TYPES, type GameType } from '@voz/shared';

const GAME_LABELS: Record<GameType, string> = {
  'minecraft-java': 'Minecraft (Java)',
  'minecraft-bedrock': 'Minecraft (Bedrock)',
  source: 'Source engine',
  'generic-tcp': 'Generic TCP',
  unknown: 'Unknown / Other',
};

type ServerData = {
  id: string;
  name: string;
  gameType: GameType;
  host: string;
  port: number;
  description: string | null;
};
type Props = { server?: ServerData };

export default function ServerFormDialog({ server }: Props) {
  const isEdit = !!server;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get('name'),
      gameType: form.get('gameType'),
      host: form.get('host'),
      port: form.get('port'),
      description: form.get('description'),
    };
    const res = await fetch(isEdit ? `/api/servers/${server!.id}` : '/api/servers', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
    setPending(false);
    if (r.ok) {
      toast.success(isEdit ? 'Server updated.' : 'Server created.');
      setOpen(false);
      location.reload();
    } else {
      toast.error(r.error ?? 'Could not save server.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={isEdit ? `Edit ${server!.name}` : undefined}
        className={cn(buttonVariants(isEdit ? { variant: 'ghost', size: 'icon' } : {}))}
      >
        {isEdit ? (
          <Pencil size={16} />
        ) : (
          <>
            <Plus size={16} />
            Add server
          </>
        )}
      </DialogTrigger>
      <DialogContent className="bg-[#0d0d14] text-white ring-[#1a1a2e]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit server' : 'Add server'}</DialogTitle>
          <DialogDescription>
            Connection details and game type are visible to all signed-in users.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name" className="text-white/70">Name</Label>
            <Input id="name" name="name" defaultValue={server?.name ?? ''} required maxLength={80} className="bg-[#0a0a0f] text-white" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="gameType" className="text-white/70">Game type</Label>
              <select
                id="gameType"
                name="gameType"
                defaultValue={server?.gameType ?? 'minecraft-java'}
                className="rounded-md border border-input bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {GAME_TYPES.map((g) => (
                  <option key={g} value={g}>{GAME_LABELS[g] ?? g}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port" className="text-white/70">Port</Label>
              <Input id="port" name="port" type="number" min={1} max={65535} defaultValue={server?.port ?? 25565} required className="bg-[#0a0a0f] text-white" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="host" className="text-white/70">Host (IP or DNS name)</Label>
            <Input id="host" name="host" defaultValue={server?.host ?? ''} required maxLength={253} placeholder="mc.example.com" className="bg-[#0a0a0f] text-white" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description" className="text-white/70">Description</Label>
            <textarea
              id="description"
              name="description"
              defaultValue={server?.description ?? ''}
              maxLength={500}
              rows={3}
              className="rounded-md border border-input bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Build**

Run: `npx nx build web`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/ServerFormDialog.tsx
git commit -m "feat(web): add server create/edit dialog island"
```

---

## Task 8: `DeleteServerButton` island

**Files:** Create `apps/web/src/components/dashboard/DeleteServerButton.tsx`

- [ ] **Step 1: Create the island**

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/button';

type Props = { id: string; name: string };

export default function DeleteServerButton({ id, name }: Props) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!confirm(`Delete server "${name}"?`)) return;
    setPending(true);
    const res = await fetch(`/api/servers/${id}`, { method: 'DELETE' });
    const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
    setPending(false);
    if (r.ok) {
      toast.success('Server deleted.');
      location.reload();
    } else {
      toast.error('Could not delete server.');
    }
  }

  return (
    <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${name}`} disabled={pending} onClick={handleClick}>
      <Trash2 size={16} />
    </Button>
  );
}
```

- [ ] **Step 2: Build**

Run: `npx nx build web`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/DeleteServerButton.tsx
git commit -m "feat(web): add delete-server button island"
```

---

## Task 9: Admin controls on the servers page

**Files:** Modify `apps/web/src/pages/dashboard/servers.astro` (replace the whole file)

Adds `admin` gating, the header "Add server" button, and a per-row actions column. Non-admin output is identical to the #4 table (no actions column / header button).

- [ ] **Step 1: Replace `apps/web/src/pages/dashboard/servers.astro` with**

```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
import { createDb, servers, type GameType } from '@voz/shared';
import Dashboard from '../../layouts/Dashboard.astro';
import { Card, CardContent } from '../../components/ui/card.tsx';
import StatusBadge from '../../components/dashboard/StatusBadge.tsx';
import ServerFormDialog from '../../components/dashboard/ServerFormDialog.tsx';
import DeleteServerButton from '../../components/dashboard/DeleteServerButton.tsx';

const db = createDb(env.DB);
const all = await db.select().from(servers).all();
const admin = Astro.locals.user?.role === 'admin';

const GAME_LABELS: Record<GameType, string> = {
  'minecraft-java': 'Minecraft (Java)',
  'minecraft-bedrock': 'Minecraft (Bedrock)',
  source: 'Source',
  'generic-tcp': 'TCP',
  unknown: 'Unknown',
};
---
<Dashboard>
  <div class="mx-auto max-w-5xl">
    <div class="mb-8 flex items-end justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Servers</h1>
        <p class="mt-1 text-white/40">Connection details for community game servers.</p>
      </div>
      {admin && <ServerFormDialog client:load />}
    </div>

    {all.length === 0 ? (
      <Card className="border-[#1a1a2e] bg-[#0d0d14]">
        <CardContent className="py-12 text-center text-white/40">
          No servers configured yet.{admin ? ' Click "Add server" to create one.' : ''}
        </CardContent>
      </Card>
    ) : (
      <div class="overflow-hidden rounded-lg border border-[#1a1a2e] bg-[#0d0d14]">
        <table class="w-full text-sm">
          <thead class="bg-[#0a0a0f] text-left text-xs uppercase tracking-wide text-white/40">
            <tr>
              <th class="px-4 py-3 font-medium">Name</th>
              <th class="px-4 py-3 font-medium">Game</th>
              <th class="px-4 py-3 font-medium">Address</th>
              <th class="px-4 py-3 font-medium">Status</th>
              {admin && <th class="px-4 py-3 font-medium" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {all.map((s) => (
              <tr class="border-t border-[#1a1a2e]">
                <td class="px-4 py-3">
                  <div class="font-medium text-white">{s.name}</div>
                  {s.description && <div class="text-xs text-white/40">{s.description}</div>}
                </td>
                <td class="px-4 py-3 text-white/70">{GAME_LABELS[s.gameType] ?? s.gameType}</td>
                <td class="px-4 py-3 font-mono text-white/70">{s.host}:{s.port}</td>
                <td class="px-4 py-3"><StatusBadge /></td>
                {admin && (
                  <td class="px-4 py-3">
                    <div class="flex justify-end gap-1">
                      <ServerFormDialog
                        client:load
                        server={{ id: s.id, name: s.name, gameType: s.gameType, host: s.host, port: s.port, description: s.description }}
                      />
                      <DeleteServerButton client:load id={s.id} name={s.name} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
</Dashboard>
```

- [ ] **Step 2: Build**

Run: `npx nx build web`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/dashboard/servers.astro
git commit -m "feat(web): add admin create/edit/delete controls to servers page"
```

---

## Task 10: Final verification

- [ ] **Step 1: Test + lint + build**

Run: `npx nx test web && npx nx lint web && npx nx build web`
Expected: all pass (zod schema + isAdmin tests green; no module-boundary/lint violations; build succeeds).

- [ ] **Step 2: Runtime smoke (local; requires the local D1 + a signed-in session)**

```bash
cd apps/web && npx wrangler d1 migrations apply voz-gg --local
cd /Users/voziv/dev/voz.gg && npx nx run web:preview
```
Promote your signed-in user to admin (replace the email), then exercise CRUD:
```bash
cd apps/web && npx wrangler d1 execute voz-gg --local \
  --command "UPDATE user SET role='admin' WHERE email='you@example.com';"
```
Manual checks (a signed-in session is needed; without dev credentials, verify at least the build + the non-admin path):
- As **admin**: `/dashboard/servers` shows "Add server"; creating a server shows a success toast and the row appears after reload; Edit changes persist; Delete removes the row (after the `confirm`).
- As **non-admin** (`role='user'`): no Add/Edit/Delete controls; `curl -X POST http://localhost:8788/api/servers` (with a non-admin session cookie) returns `403`; an unauthenticated request to `/api/servers` redirects to `/sign-in` (middleware).
- Invalid input (e.g. port `70000`) is rejected with the zod message in an error toast.
- No Base UI hydration-mismatch warnings in the browser console when a dialog opens.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "test(web): verify admin server CRUD acceptance"
```

---

## Notes for #6

- **#6 (status monitor):** replace the `StatusBadge` placeholder with live data from the Go service; the servers page already renders a status cell per row, and the admin actions column is independent of it.
- The Base UI hydration gotcha is handled in `dialog.tsx` (close buttons styled via `buttonVariants`, not `render={<Button/>}`); keep that pattern for any future dialog triggers.
- Admin promotion remains manual D1 SQL; a user-management UI is a candidate for a later sub-project.
