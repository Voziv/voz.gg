# Data backbone + profile management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authenticated voz.gg dashboard — shadcn/Base UI foundation, dashboard shell, profile management (name/bio, Minecraft + Steam linking), the `servers` table, and a read-only servers list — on top of the #3 auth layer.

**Architecture:** Astro SSR pages under `/dashboard/*` (protected by the existing #3 middleware) compose React islands built from `base-vega` shadcn components on Base UI. Server-rendered shell (sidebar/user chip) reads `Astro.locals.user`; interactive bits are islands. Profile name/bio updates go through the better-auth client; Minecraft/Steam linking go through server API routes that persist to D1 via Drizzle.

**Tech Stack:** Astro 6 SSR (`@astrojs/cloudflare`), `@astrojs/react` islands, Base UI (`@base-ui/react`) + shadcn `base-vega` + CVA + `tailwind-merge`, `lucide-react`, `sonner`, Drizzle/D1, Vitest.

**Key facts (verified against the codebase / #3):**
- D1 binding is **`DB`**; env is read via **`import { env } from 'cloudflare:workers'`** (NOT `locals.runtime.env` — removed in `@astrojs/cloudflare` 13). See `apps/web/src/middleware.ts`, `apps/web/src/pages/api/auth/steam/callback.ts`.
- `Astro.locals.user` is set by `apps/web/src/middleware.ts`; `/dashboard/*` is already protected (unauth → `/sign-in`).
- The better-auth client is `apps/web/src/lib/auth-client.ts` (`authClient`, `signIn`, `signOut`, `useSession`). `displayName`/`bio` are `input:true` additionalFields → updatable via `authClient.updateUser({...})`. `minecraft*`/`steam*` are `input:false` → server-only.
- Drizzle schema/types live in `libs/shared/src/schema.ts` (exports `user`, `createDb`, etc.); `drizzle.config.ts` → `out: ./drizzle/migrations`. `eq` comes from `drizzle-orm` (already a dep).
- Vitest runs via `npx nx test web` (`vitest run --passWithNoTests`, includes `src/**/*.test.ts`).
- Tailwind 4 + the OKLch theme (incl. `--color-sidebar-*`) are already in `apps/web/src/styles/global.css`; the landing foundation **omitted** `@import "tw-animate-css"` and the shadcn base layer — Task 1 adds them.
- Source to port from: `~/dev/game-server-panel/src/components/ui/*`, `~/dev/game-server-panel/src/components/dashboard/*`, `~/dev/game-server-panel/src/lib/mojang.ts`.

**Commit signing:** the repo signs commits via SSH/1Password, which may be intermittently unavailable. Try a normal `git commit`; if it fails with a 1Password/signing error, retry the SAME commit once as `git -c commit.gpgsign=false commit -m "..."` (per-command only — never change persistent git config).

**TDD note:** the Mojang lib is strict TDD. Routes and React islands are integration-heavy (need a session + live Mojang/Steam) — those tasks use build/lint verification with exact commands; live round-trips are noted where they need real data.

---

## File structure

| path | responsibility |
|------|----------------|
| `apps/web/src/lib/utils.ts` | `cn()` (clsx + tailwind-merge) |
| `apps/web/src/lib/mojang.ts` (+ `.test.ts`) | Mojang username→UUID lookup (pure, fetch-injected) |
| `apps/web/src/components/ui/{button,card,input,label,badge,sonner}.tsx` | base-vega shadcn primitives (Base UI) |
| `apps/web/src/components/dashboard/ProfileForm.tsx` | island — edit name/bio via better-auth client |
| `apps/web/src/components/dashboard/MinecraftField.tsx` | island — Mojang lookup + link/unlink |
| `apps/web/src/components/dashboard/SteamLinkCard.tsx` | island — show/unlink Steam, link button |
| `apps/web/src/components/dashboard/SignOut.tsx` | island — sign out via better-auth client |
| `apps/web/src/components/dashboard/StatusBadge.tsx` | placeholder status badge (live data in #6) |
| `apps/web/src/layouts/Dashboard.astro` | shell: sidebar + header + toaster |
| `apps/web/src/pages/dashboard/index.astro` | redirect → `/dashboard/profile` |
| `apps/web/src/pages/dashboard/profile.astro` | profile page (3 cards) |
| `apps/web/src/pages/dashboard/servers.astro` | read-only servers table |
| `apps/web/src/pages/api/profile/minecraft.ts` | GET lookup / POST link+unlink |
| `apps/web/src/pages/api/profile/steam/unlink.ts` | POST unlink Steam |
| `libs/shared/src/schema.ts` | + `servers` table + `GameType` |
| `apps/web/src/styles/global.css` | + tw-animate-css + shadcn base layer |

---

## Task 1: shadcn/Base UI dependencies + `cn` util + global.css

**Files:**
- Create: `apps/web/src/lib/utils.ts`
- Modify: `apps/web/package.json`, `apps/web/src/styles/global.css`

- [ ] **Step 1: Install deps**

```bash
pnpm add --filter @voz/web @base-ui/react class-variance-authority clsx tailwind-merge lucide-react sonner
pnpm add -D --filter @voz/web tw-animate-css
```

- [ ] **Step 2: Create `apps/web/src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Add the animation + shadcn base layer to `apps/web/src/styles/global.css`**

At the very top, the file currently starts with `@import "tailwindcss";`. Add directly after it:
```css
@import "tw-animate-css";
```
(The OKLch theme, `.dark`, and `--color-sidebar-*` tokens are already present below — do not duplicate them. The source app also imported `shadcn/tailwind.css`; that package is not a dependency here and the base-vega primitives we port do not require it because all needed CSS variables already exist in this file. Do NOT add a `shadcn/tailwind.css` import.)

- [ ] **Step 4: Build**

Run: `npx nx build web`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/utils.ts apps/web/package.json apps/web/src/styles/global.css pnpm-lock.yaml
git commit -m "feat(web): add base-ui/shadcn deps, cn util, and tw-animate-css"
```

---

## Task 2: Port the base-vega UI primitives

Port six primitives verbatim from the source, changing ONLY the import of `cn` (and removing any Next-specific imports). They are React components used inside islands.

**Files (create):** `apps/web/src/components/ui/{button,card,input,label,badge,sonner}.tsx`

- [ ] **Step 1: Copy each primitive from the source with import rewrites**

For each file below, copy `~/dev/game-server-panel/src/components/ui/<name>.tsx` to `apps/web/src/components/ui/<name>.tsx`, then apply these transforms:
- Replace `import { cn } from "@/lib/utils"` → `import { cn } from "../../lib/utils"`.
- Keep all `@base-ui/react/*` imports as-is.
- Remove any `import 'server-only'` if present (none expected in `ui/`).
- For `sonner.tsx`: the source uses `next-themes` (`useTheme`) to pick the toast theme. Remove the `next-themes` import and usage; hardcode `theme="dark"`. The component should export `Toaster` wrapping sonner's `<Sonner theme="dark" {...props} />`.

Files to port: `button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `badge.tsx`, `sonner.tsx`.

- [ ] **Step 2: Verify the `sonner.tsx` has no `next-themes` import**

Run: `grep -rn "next-themes" apps/web/src/components/ui/` 
Expected: no matches.

- [ ] **Step 3: Build**

Run: `npx nx build web`
Expected: succeeds (the primitives compile; they are not mounted yet).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui
git commit -m "feat(web): port base-vega shadcn primitives (button/card/input/label/badge/sonner)"
```

---

## Task 3: Mojang lib (TDD)

**Files:**
- Create: `apps/web/src/lib/mojang.ts`
- Test: `apps/web/src/lib/mojang.test.ts`

- [ ] **Step 1: Write the failing test — `apps/web/src/lib/mojang.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { isValidMinecraftUsernameSyntax, lookupMinecraftProfile } from './mojang';

describe('isValidMinecraftUsernameSyntax', () => {
  it.each(['Notch', 'abc', 'a_1_B', 'sixteen_chars_16'])('accepts %s', (n) =>
    expect(isValidMinecraftUsernameSyntax(n)).toBe(true),
  );
  it.each(['ab', 'this_name_is_too_long', 'has space', 'bad-dash'])('rejects %s', (n) =>
    expect(isValidMinecraftUsernameSyntax(n)).toBe(false),
  );
});

describe('lookupMinecraftProfile', () => {
  it('returns a dashed uuid + name on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch' })));
    const result = await lookupMinecraftProfile('Notch', fetchMock);
    expect(result).toEqual({ uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Notch' });
    expect(fetchMock.mock.calls[0][0]).toContain('users/profiles/minecraft/Notch');
  });

  it('returns null for an invalid username without fetching', async () => {
    const fetchMock = vi.fn();
    expect(await lookupMinecraftProfile('ab', fetchMock)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    expect(await lookupMinecraftProfile('Ghostxyz', fetchMock)).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    expect(await lookupMinecraftProfile('Notch', fetchMock)).toBeNull();
  });

  it('returns null when the payload lacks id/name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
    expect(await lookupMinecraftProfile('Notch', fetchMock)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test web`
Expected: FAIL — `Cannot find module './mojang'`.

- [ ] **Step 3: Implement `apps/web/src/lib/mojang.ts`**

```ts
const MOJANG_RE = /^[A-Za-z0-9_]{3,16}$/;

export type MojangProfile = { uuid: string; name: string };

export function isValidMinecraftUsernameSyntax(name: string): boolean {
  return MOJANG_RE.test(name);
}

function dashUuid(undashed: string): string {
  return [
    undashed.slice(0, 8),
    undashed.slice(8, 12),
    undashed.slice(12, 16),
    undashed.slice(16, 20),
    undashed.slice(20),
  ].join('-');
}

export async function lookupMinecraftProfile(
  username: string,
  fetchFn: typeof fetch = fetch,
): Promise<MojangProfile | null> {
  if (!isValidMinecraftUsernameSyntax(username)) return null;
  const url = `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`;
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404 || res.status === 204) return null;
  if (!res.ok) return null;
  const json = (await res.json()) as { id?: string; name?: string };
  if (!json.id || !json.name) return null;
  return { uuid: dashUuid(json.id), name: json.name };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/mojang.ts apps/web/src/lib/mojang.test.ts
git commit -m "feat(web): port mojang profile lookup (tdd)"
```

---

## Task 4: Add the `servers` table to the schema

**Files:**
- Modify: `libs/shared/src/schema.ts`

- [ ] **Step 1: Append the `servers` table to `libs/shared/src/schema.ts`**

The file already imports `sqliteTable, text, integer` from `drizzle-orm/sqlite-core` and defines `user`. Append:

```ts
export const GAME_TYPES = [
  'minecraft-java',
  'minecraft-bedrock',
  'source',
  'generic-tcp',
  'unknown',
] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const servers = sqliteTable('servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  gameType: text('game_type').notNull().$type<GameType>(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  description: text('description'),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
```

- [ ] **Step 2: Typecheck**

Run: `npx nx build shared`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add libs/shared/src/schema.ts
git commit -m "feat(shared): add servers table and GameType"
```

---

## Task 5: Generate and apply the D1 migration

**Files:** Create (generated): `apps/web/drizzle/migrations/0002_*.sql` (+ meta)

- [ ] **Step 1: Generate**

Run: `cd apps/web && npx drizzle-kit generate`
Expected: a new `drizzle/migrations/0002_*.sql` with `CREATE TABLE \`servers\``.

- [ ] **Step 2: Apply locally**

Run: `cd apps/web && npx wrangler d1 migrations apply voz-gg --local`
Expected: `0002_*` applied; no errors.

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx wrangler d1 execute voz-gg --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='servers';"`
Expected: returns `servers`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/drizzle/migrations
git commit -m "feat(web): generate d1 migration for servers table"
```

---

## Task 6: Minecraft API route (lookup + link/unlink)

**Files:** Create `apps/web/src/pages/api/profile/minecraft.ts`

- [ ] **Step 1: Implement the route**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, user } from '@voz/shared';
import { isValidMinecraftUsernameSyntax, lookupMinecraftProfile } from '../../../lib/mojang';

export const prerender = false;

// GET ?username=Notch → Mojang lookup only (no persistence).
export const GET: APIRoute = async (ctx) => {
  if (!ctx.locals.user) return new Response('Unauthorized', { status: 401 });
  const username = (ctx.url.searchParams.get('username') ?? '').trim();
  if (!isValidMinecraftUsernameSyntax(username)) {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  const profile = await lookupMinecraftProfile(username);
  if (!profile) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  return Response.json({ ok: true, uuid: profile.uuid, name: profile.name });
};

// POST { username } → link; POST { username: "" } → unlink.
export const POST: APIRoute = async (ctx) => {
  const current = ctx.locals.user;
  if (!current) return new Response('Unauthorized', { status: 401 });

  const body = (await ctx.request.json().catch(() => ({}))) as { username?: string };
  const username = (body.username ?? '').trim();
  const db = createDb(env.DB);

  if (username === '') {
    await db
      .update(user)
      .set({ minecraftUuid: null, minecraftName: null, updatedAt: new Date() })
      .where(eq(user.id, current.id));
    return Response.json({ ok: true, unlinked: true });
  }

  if (!isValidMinecraftUsernameSyntax(username)) {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  const profile = await lookupMinecraftProfile(username);
  if (!profile) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });

  await db
    .update(user)
    .set({ minecraftUuid: profile.uuid, minecraftName: profile.name, updatedAt: new Date() })
    .where(eq(user.id, current.id));
  return Response.json({ ok: true, uuid: profile.uuid, name: profile.name });
};
```

- [ ] **Step 2: Build**

Run: `npx nx build web`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/api/profile/minecraft.ts
git commit -m "feat(web): add minecraft lookup/link/unlink api route"
```

---

## Task 7: Steam unlink API route

**Files:** Create `apps/web/src/pages/api/profile/steam/unlink.ts`

- [ ] **Step 1: Implement**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, user } from '@voz/shared';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const current = ctx.locals.user;
  if (!current) return new Response('Unauthorized', { status: 401 });
  const db = createDb(env.DB);
  await db
    .update(user)
    .set({ steamId64: null, steamPersona: null, steamAvatar: null, updatedAt: new Date() })
    .where(eq(user.id, current.id));
  return Response.json({ ok: true });
};
```

- [ ] **Step 2: Build**

Run: `npx nx build web`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/api/profile/steam/unlink.ts
git commit -m "feat(web): add steam unlink api route"
```

---

## Task 8: Profile islands (ProfileForm, MinecraftField, SteamLinkCard, SignOut)

These port the source dashboard components, converting Next server actions to the better-auth client / fetch to the routes from Tasks 6–7. **Base UI hydration gotcha (AGENTS.md):** never put a Base-UI-derived component (e.g. `Button`) in another primitive's `render` prop — style the element directly with `buttonVariants`. The source `SteamLinkCard` violates this (`<Button render={<a/>}>`); the port below fixes it.

**Files (create):** `apps/web/src/components/dashboard/{ProfileForm,MinecraftField,SteamLinkCard,SignOut}.tsx`

- [ ] **Step 1: `ProfileForm.tsx`**

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '../../lib/auth-client';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';

type Props = { defaultDisplayName: string; defaultBio: string };

export default function ProfileForm({ defaultDisplayName, defaultBio }: Props) {
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [bio, setBio] = useState(defaultBio);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.updateUser({ displayName, bio });
    setPending(false);
    if (error) toast.error(error.message ?? 'Could not save profile.');
    else toast.success('Profile saved.');
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="displayName" className="text-white/70">Display name</Label>
        <Input
          id="displayName"
          value={displayName}
          maxLength={80}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="How should we address you?"
          className="bg-[#0a0a0f] text-white"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="bio" className="text-white/70">Bio</Label>
        <textarea
          id="bio"
          value={bio}
          maxLength={500}
          rows={4}
          onChange={(e) => setBio(e.target.value)}
          placeholder="A short blurb about you."
          className="rounded-md border border-input bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
      <div>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: `MinecraftField.tsx`** (debounced lookup via `GET`, save/unlink via `POST`)

```tsx
import { useEffect, useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';

type Props = { defaultUsername: string; defaultUuid: string | null };
type ServerResult =
  | { for: string; ok: true; uuid: string; name: string }
  | { for: string; ok: false; error: string };
type Lookup =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; uuid: string; name: string }
  | { state: 'err'; message: string };

const FORMAT_RE = /^[A-Za-z0-9_]{3,16}$/;

function deriveLookup(trimmed: string, server: ServerResult | null): Lookup {
  if (trimmed === '') return { state: 'idle' };
  if (!FORMAT_RE.test(trimmed)) return { state: 'err', message: 'Letters, numbers, underscores; 3–16 chars.' };
  if (server && server.for === trimmed) {
    return server.ok ? { state: 'ok', uuid: server.uuid, name: server.name } : { state: 'err', message: server.error };
  }
  return { state: 'checking' };
}

function StatusIcon({ state }: { state: Lookup['state'] }) {
  if (state === 'checking') return <Loader2 className="size-4 animate-spin text-white/40" aria-label="Checking" />;
  if (state === 'ok') return <Check className="size-4 text-emerald-400" aria-label="Valid" />;
  if (state === 'err') return <X className="size-4 text-red-400" aria-label="Invalid" />;
  return <span className="size-4" aria-hidden />;
}

export default function MinecraftField({ defaultUsername, defaultUuid }: Props) {
  const [value, setValue] = useState(defaultUsername);
  const [serverResult, setServerResult] = useState<ServerResult | null>(
    defaultUsername && defaultUuid
      ? { for: defaultUsername, ok: true, uuid: defaultUuid, name: defaultUsername }
      : null,
  );
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const v = value.trim();
    if (v === '' || !FORMAT_RE.test(v)) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const res = await fetch(`/api/profile/minecraft?username=${encodeURIComponent(v)}`);
      const r = (await res.json()) as { ok: boolean; uuid?: string; name?: string; error?: string };
      if (cancelled) return;
      setServerResult(
        r.ok && r.uuid && r.name
          ? { for: v, ok: true, uuid: r.uuid, name: r.name }
          : { for: v, ok: false, error: r.error === 'not_found' ? 'No such Minecraft user.' : 'Invalid username.' },
      );
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [value]);

  const trimmed = value.trim();
  const lookup = deriveLookup(trimmed, serverResult);
  const avatarUuid =
    lookup.state === 'ok' ? lookup.uuid : trimmed === defaultUsername && defaultUuid ? defaultUuid : null;

  async function persist(username: string) {
    setPending(true);
    const res = await fetch('/api/profile/minecraft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const r = (await res.json()) as { ok: boolean; error?: string };
    setPending(false);
    return r;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const r = await persist(trimmed);
    if (r.ok) toast.success('Minecraft account linked.');
    else toast.error('Could not link account.');
  }

  async function handleUnlink() {
    const r = await persist('');
    if (r.ok) { setValue(''); setServerResult(null); toast.success('Minecraft account unlinked.'); }
    else toast.error('Could not unlink.');
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <Label htmlFor="username" className="text-white/70">Minecraft username</Label>
      <div className="flex items-center gap-3">
        {avatarUuid ? (
          <img
            src={`https://crafatar.com/avatars/${avatarUuid}?size=48&overlay`}
            alt=""
            width={48}
            height={48}
            className="size-12 rounded-md ring-1 ring-[#1a1a2e]"
          />
        ) : (
          <div className="size-12 rounded-md bg-[#1a1a2e]" aria-hidden />
        )}
        <div className="flex flex-1 items-center gap-2">
          <Input
            id="username"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Notch"
            maxLength={16}
            className="bg-[#0a0a0f] text-white"
          />
          <StatusIcon state={lookup.state} />
        </div>
      </div>
      <div className="min-h-5 text-xs">
        {lookup.state === 'ok' && <span className="text-emerald-400">Verified as {lookup.name}.</span>}
        {lookup.state === 'err' && <span className="text-red-400">{lookup.message}</span>}
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending || lookup.state === 'checking' || lookup.state === 'err' || lookup.state === 'idle'}
        >
          {pending ? 'Saving…' : 'Link Minecraft account'}
        </Button>
        {defaultUuid && (
          <Button type="button" variant="outline" disabled={pending} onClick={handleUnlink}>Unlink</Button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: `SteamLinkCard.tsx`** (note the gotcha fix — link is a styled `<a>`, not `<Button render={<a/>}>`)

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';

type Props = { steamId64: string | null; persona: string | null; avatarUrl: string | null };

export default function SteamLinkCard({ steamId64, persona, avatarUrl }: Props) {
  const [pending, setPending] = useState(false);

  async function handleUnlink() {
    setPending(true);
    const res = await fetch('/api/profile/steam/unlink', { method: 'POST' });
    setPending(false);
    if (res.ok) { toast.success('Steam account unlinked.'); location.reload(); }
    else toast.error('Could not unlink Steam.');
  }

  if (!steamId64) {
    return (
      <div className="flex items-center justify-between rounded-md border border-[#1a1a2e] bg-[#0a0a0f] p-4">
        <div>
          <p className="text-sm text-white">Steam not linked</p>
          <p className="text-xs text-white/40">Link your Steam account to verify ownership of your Steam ID.</p>
        </div>
        <a href="/api/auth/steam/initiate" className={cn(buttonVariants())}>Link Steam</a>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-[#1a1a2e] bg-[#0a0a0f] p-4">
      <div className="flex items-center gap-3">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" width={48} height={48} className="size-12 rounded-md ring-1 ring-[#1a1a2e]" />
        ) : (
          <div className="size-12 rounded-md bg-[#1a1a2e]" aria-hidden />
        )}
        <div>
          <p className="text-sm text-white">{persona || 'Steam linked'}</p>
          <p className="font-mono text-xs text-white/40">SteamID64: {steamId64}</p>
        </div>
      </div>
      <Button type="button" variant="outline" disabled={pending} onClick={handleUnlink}>
        {pending ? 'Unlinking…' : 'Unlink'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: `SignOut.tsx`**

```tsx
import { useState } from 'react';
import { authClient } from '../../lib/auth-client';
import { Button } from '../ui/button';

export default function SignOut() {
  const [pending, setPending] = useState(false);
  async function handleClick() {
    setPending(true);
    await authClient.signOut();
    location.href = '/';
  }
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={handleClick}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
```

- [ ] **Step 5: Build**

Run: `npx nx build web`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/dashboard
git commit -m "feat(web): add profile islands (name/bio, minecraft, steam, sign-out)"
```

---

## Task 9: StatusBadge placeholder + Dashboard shell layout

**Files:**
- Create: `apps/web/src/components/dashboard/StatusBadge.tsx`, `apps/web/src/layouts/Dashboard.astro`

- [ ] **Step 1: `StatusBadge.tsx`** (placeholder; live data arrives in #6)

```tsx
import { Badge } from '../ui/badge';

// Sub-project #6 (status monitor) replaces this with live online/offline data.
export default function StatusBadge() {
  return (
    <Badge variant="outline" className="border-white/15 bg-white/5 text-white/60">
      Unknown
    </Badge>
  );
}
```

- [ ] **Step 2: `Dashboard.astro`** (server-rendered shell; sidebar active state from the URL)

```astro
---
import Base from './Base.astro';
import SignOut from '../components/dashboard/SignOut.tsx';
import { Toaster } from '../components/ui/sonner.tsx';

const { user } = Astro.locals;
const path = Astro.url.pathname;
const nav = [
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/servers', label: 'Servers' },
];
const isActive = (href: string) => path === href || path.startsWith(`${href}/`);
const label = user?.displayName ?? user?.name ?? user?.email ?? '';
---
<Base>
  <div class="flex min-h-screen bg-[#0a0a0f] text-white">
    <aside class="hidden w-60 shrink-0 border-r border-[#1a1a2e] md:block">
      <nav class="flex flex-col gap-1 p-4">
        <a href="/" class="mb-6 px-2 py-1 text-2xl font-bold tracking-tight text-white" style="text-shadow: 0 0 24px rgba(0,229,255,0.35)">voz.gg</a>
        {nav.map((item) => (
          <a
            href={item.href}
            class:list={[
              'rounded-md px-3 py-2 text-sm transition-colors',
              isActive(item.href)
                ? 'bg-[#00e5ff]/10 text-[#00e5ff] ring-1 ring-[#00e5ff]/30'
                : 'text-white/60 hover:bg-white/5 hover:text-white',
            ]}
          >{item.label}</a>
        ))}
      </nav>
    </aside>
    <div class="flex flex-1 flex-col">
      <header class="flex items-center justify-end gap-3 border-b border-[#1a1a2e] px-6 py-3 text-sm">
        <span class="text-white/60">{label}</span>
        <SignOut client:load />
      </header>
      <main class="flex-1 p-6 md:p-10"><slot /></main>
    </div>
    <Toaster client:load theme="dark" position="bottom-right" />
  </div>
</Base>
```

(Note: `Base.astro` provides `<html>/<head>/<body>`; `Dashboard.astro` renders inside it. The lucide `User`/`Server` imports are optional decoration — include icons next to nav labels if desired, or drop the import. Keep it simple: labels only is fine.)

- [ ] **Step 3: Build**

Run: `npx nx build web`
Expected: succeeds (the `Toaster` and `SignOut` islands hydrate; the shell is server-rendered).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/dashboard/StatusBadge.tsx apps/web/src/layouts/Dashboard.astro
git commit -m "feat(web): add dashboard shell layout and placeholder status badge"
```

---

## Task 10: Dashboard pages (index redirect, profile, servers)

**Files:**
- Replace: `apps/web/src/pages/dashboard/index.astro`
- Create: `apps/web/src/pages/dashboard/profile.astro`, `apps/web/src/pages/dashboard/servers.astro`

- [ ] **Step 1: `index.astro` → redirect to profile**

```astro
---
export const prerender = false;
return Astro.redirect('/dashboard/profile');
---
```

- [ ] **Step 2: `profile.astro`**

```astro
---
export const prerender = false;
import Dashboard from '../../layouts/Dashboard.astro';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card.tsx';
import ProfileForm from '../../components/dashboard/ProfileForm.tsx';
import MinecraftField from '../../components/dashboard/MinecraftField.tsx';
import SteamLinkCard from '../../components/dashboard/SteamLinkCard.tsx';

const user = Astro.locals.user!;
const steam = Astro.url.searchParams.get('steam'); // linked | conflict | error
const steamBanner =
  steam === 'linked' ? { kind: 'success', text: 'Steam account linked.' }
  : steam === 'conflict' ? { kind: 'error', text: 'That Steam account is already linked to another user.' }
  : steam === 'error' ? { kind: 'error', text: 'Steam linking failed. Try again.' }
  : null;
---
<Dashboard>
  <div class="mx-auto grid max-w-3xl gap-6">
    <div>
      <h1 class="text-3xl font-bold tracking-tight">Profile</h1>
      <p class="mt-1 text-white/40">Tell people about yourself and link your game accounts.</p>
    </div>

    {steamBanner && (
      <div
        class:list={['rounded-md border px-4 py-3 text-sm',
          steamBanner.kind === 'error'
            ? 'border-red-500/30 bg-red-500/10 text-red-300'
            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300']}
        role={steamBanner.kind === 'error' ? 'alert' : 'status'}
      >{steamBanner.text}</div>
    )}

    <Card className="border-[#1a1a2e] bg-[#0d0d14]">
      <CardHeader>
        <CardTitle className="text-white">About you</CardTitle>
        <CardDescription className="text-white/40">Display name and bio shown to other users.</CardDescription>
      </CardHeader>
      <CardContent>
        <ProfileForm client:load defaultDisplayName={user.displayName ?? ''} defaultBio={user.bio ?? ''} />
      </CardContent>
    </Card>

    <Card className="border-[#1a1a2e] bg-[#0d0d14]">
      <CardHeader>
        <CardTitle className="text-white">Minecraft</CardTitle>
        <CardDescription className="text-white/40">We verify the username via the Mojang API.</CardDescription>
      </CardHeader>
      <CardContent>
        <MinecraftField client:load defaultUsername={user.minecraftName ?? ''} defaultUuid={user.minecraftUuid ?? null} />
      </CardContent>
    </Card>

    <Card className="border-[#1a1a2e] bg-[#0d0d14]">
      <CardHeader>
        <CardTitle className="text-white">Steam</CardTitle>
        <CardDescription className="text-white/40">Link via Steam OpenID to prove ownership of your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <SteamLinkCard client:load steamId64={user.steamId64 ?? null} persona={user.steamPersona ?? null} avatarUrl={user.steamAvatar ?? null} />
      </CardContent>
    </Card>
  </div>
</Dashboard>
```

- [ ] **Step 3: `servers.astro`** (read-only)

```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
import { createDb, servers, type GameType } from '@voz/shared';
import Dashboard from '../../layouts/Dashboard.astro';
import { Card, CardContent } from '../../components/ui/card.tsx';
import StatusBadge from '../../components/dashboard/StatusBadge.tsx';

const db = createDb(env.DB);
const all = await db.select().from(servers).all();

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
    <div class="mb-8">
      <h1 class="text-3xl font-bold tracking-tight">Servers</h1>
      <p class="mt-1 text-white/40">Connection details for community game servers.</p>
    </div>

    {all.length === 0 ? (
      <Card className="border-[#1a1a2e] bg-[#0d0d14]">
        <CardContent className="py-12 text-center text-white/40">No servers configured yet.</CardContent>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
</Dashboard>
```

(Note: `StatusBadge` has no interactivity yet, so `client:load` is optional — it can render server-side without a directive. Using no directive avoids shipping JS for it; prefer `<StatusBadge />` with no directive. Keep it directive-free.)

- [ ] **Step 4: Build**

Run: `npx nx build web`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/dashboard
git commit -m "feat(web): add dashboard index/profile/servers pages"
```

---

## Task 11: Final verification

- [ ] **Step 1: Test + lint + build**

Run: `npx nx test web && npx nx lint web && npx nx build web`
Expected: all pass (Mojang tests green; no module-boundary/lint violations; build succeeds; landing page still prerendered).

- [ ] **Step 2: Runtime smoke (local; requires the local D1 migrated)**

Apply migrations and start preview:
```bash
cd apps/web && npx wrangler d1 migrations apply voz-gg --local
cd /Users/voziv/dev/voz.gg && npx nx run web:preview
```
Manual checks (a signed-in session is needed for the protected pages — if no dev credentials are configured, verify at least the unauthenticated redirect and the build):
- Unauthenticated `GET /dashboard/profile` → 302 `/sign-in` (from #3 middleware).
- With a session: `/dashboard` redirects to `/dashboard/profile`; the sidebar shows Profile/Servers; editing name/bio shows a success toast and persists across reload; a valid Minecraft username verifies + links; unlink clears it; the Steam card reflects link state; `/dashboard/servers` shows the empty state (or a manually-inserted row).
- No Base UI hydration-mismatch warnings in the browser console.

Manually insert a server row to exercise the table (optional):
```bash
cd apps/web && npx wrangler d1 execute voz-gg --local --command "INSERT INTO servers (id,name,game_type,host,port,created_by,created_at,updated_at) VALUES ('testserver01','Test','minecraft-java','play.example.com',25565,(SELECT id FROM user LIMIT 1),0,0);"
```

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "test(web): verify data/profile acceptance"
```

---

## Notes for #5 / #6

- **#5 (admin server CRUD):** add the `dialog` primitive + a server form/delete island, the `POST/PUT/DELETE /api/servers` routes (admin-gated on `Astro.locals.user.role === 'admin'`), nanoid for ids, and the Add/Edit/Delete controls on the servers page (the `created_by` FK and `GameType` are ready).
- **#6 (status monitor):** replace `StatusBadge` placeholder with live data from the Go service; the servers page already renders a status cell per row.
- The Base UI hydration gotcha is handled here (SteamLinkCard link is a styled `<a>`, not a `Button render={<a/>}`); keep that pattern for #5's dialog triggers.
