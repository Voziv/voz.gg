# Light / Dark / System Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a System/Light/Dark theme switcher that follows OS preference live, persists to `localStorage` for guests and to the user profile for logged-in users (profile wins), with no flash of the wrong theme, plus a full recolor of the app to the leerobert.ca palette via theme tokens.

**Architecture:** A synchronous inline `<head>` script sets the `dark` class on `<html>` before first paint (reading the server-embedded profile theme for logged-in users, else `localStorage`). A framework-agnostic `theme.ts` module owns resolution/persistence logic (pure functions unit-tested). A `ThemeToggle` React island renders the 3-way control and persists changes. Colors move from hardcoded hex to a two-layer token system (raw `--blue-*`/`--slate-*` scales → shadcn semantic tokens) toggled by the existing `.dark` class.

**Tech Stack:** Astro 6 SSR + `@astrojs/cloudflare`, React 19 islands (`@astrojs/react`, Base UI), Tailwind 4 (CSS-config, OKLch→hex tokens), better-auth, Drizzle + Cloudflare D1, Vitest, lucide-react.

---

## Reference: color mapping cheat-sheet

Used throughout the recolor tasks. Brand OAuth button colors (Discord `#5865F2`, Google `bg-white text-black`) are **intentionally exempt** — leave them.

| Hardcoded value | Token replacement |
|---|---|
| `bg-[#0a0a0f]` (app background) | `bg-background` |
| `bg-[#0d0d14]` (card / panel) | `bg-card` |
| `border-[#1a1a2e]`, `ring-[#1a1a2e]` | `border-border`, `ring-border` |
| `bg-[#1a1a2e]` (placeholder block) | `bg-muted` |
| `text-white` | `text-foreground` |
| `text-white/70`, `text-white/60`, `text-white/40` | `text-muted-foreground` |
| `hover:bg-white/5` / `hover:text-white` | `hover:bg-muted` / `hover:text-foreground` |
| `border-white/15 bg-white/5` (badge) | `border-border bg-muted` |
| `#00e5ff` (cyan accent, any form) | `primary` (`text-primary`, `bg-primary/10`, `border-primary`, `ring-primary/30`) |
| `#00ff88` (status green) | `success` (`text-success`, or SVG `fill="var(--success)"`) |
| SVG `stroke="#2a2a3e"` | `stroke="var(--border)"` |
| wordmark glow `style="text-shadow: …"` | **delete the inline style** |

---

## Task 1: Add `theme` to the user profile (schema + auth + migration)

**Files:**
- Modify: `libs/shared/src/schema.ts:11-34`
- Modify: `apps/web/src/lib/auth.ts:24-33`
- Create: `apps/web/drizzle/migrations/0004_*.sql` (generated)

- [ ] **Step 1: Add the `theme` column to the `user` table**

In `libs/shared/src/schema.ts`, add a nullable `theme` column at the end of the custom-fields block (after `steamAvatar`, line 33):

```typescript
  steamAvatar: text('steam_avatar'),
  theme: text('theme'),
});
```

- [ ] **Step 2: Register `theme` as a better-auth additional field**

In `apps/web/src/lib/auth.ts`, inside `user.additionalFields` (after `steamAvatar`, line 32):

```typescript
        steamAvatar: { type: 'string', required: false, input: false },
        theme: { type: 'string', required: false, input: true },
      },
```

`input: true` lets `authClient.updateUser({ theme })` accept it; the field then appears on `Auth['$Infer'].Session.user`, so `Astro.locals.user?.theme` is typed.

- [ ] **Step 3: Generate the migration**

Run: `npx nx run web:db:generate`
Expected: a new file `apps/web/drizzle/migrations/0004_*.sql` containing approximately:

```sql
ALTER TABLE `user` ADD `theme` text;
```

- [ ] **Step 4: Apply the migration locally**

Run: `npx nx run web:migrate:local`
Expected: wrangler reports the migration applied to the local `voz-gg` D1 database.
(Remote apply — `npx nx run web:migrate` — happens at deploy time, not in this plan.)

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/schema.ts apps/web/src/lib/auth.ts apps/web/drizzle/migrations
git commit -m "feat(shared): add theme preference column to user"
```

---

## Task 2: `theme.ts` — types, constants, and pure resolution logic (TDD)

**Files:**
- Create: `apps/web/src/lib/theme.ts`
- Test: `apps/web/src/lib/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/theme.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveMode, resolveInitialMode } from './theme';

describe('resolveMode', () => {
  it('returns the explicit mode regardless of OS preference', () => {
    expect(resolveMode('dark', false)).toBe('dark');
    expect(resolveMode('light', true)).toBe('light');
  });
  it('follows the OS preference in system mode', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
  });
});

describe('resolveInitialMode', () => {
  it('prefers a valid profile theme over a stored theme', () => {
    expect(resolveInitialMode({ profileTheme: 'light', storedTheme: 'dark' })).toBe('light');
  });
  it('falls back to the stored theme when the profile theme is null', () => {
    expect(resolveInitialMode({ profileTheme: null, storedTheme: 'dark' })).toBe('dark');
  });
  it('falls back to the stored theme when the profile theme is invalid', () => {
    expect(resolveInitialMode({ profileTheme: 'neon', storedTheme: 'light' })).toBe('light');
  });
  it('falls back to system when neither is a valid mode', () => {
    expect(resolveInitialMode({ profileTheme: null, storedTheme: null })).toBe('system');
    expect(resolveInitialMode({ profileTheme: 'bogus', storedTheme: 'bogus' })).toBe('system');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/theme.test.ts`
Expected: FAIL — `Failed to resolve import "./theme"` / `resolveMode is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/web/src/lib/theme.ts`:

```typescript
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'voz-theme';
export const THEME_CHANGE_EVENT = 'voz:themechange';

function isMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveMode(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return prefersDark ? 'dark' : 'light';
}

export function resolveInitialMode(opts: {
  profileTheme?: string | null;
  storedTheme?: string | null;
}): ThemeMode {
  if (isMode(opts.profileTheme)) return opts.profileTheme;
  if (isMode(opts.storedTheme)) return opts.storedTheme;
  return 'system';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/theme.test.ts`
Expected: PASS — all 6 assertions green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/theme.ts apps/web/src/lib/theme.test.ts
git commit -m "feat(web): add theme resolution helpers"
```

---

## Task 3: `theme.ts` — DOM persistence & apply helpers

**Files:**
- Modify: `apps/web/src/lib/theme.ts`

No new unit tests: these functions touch `window`/`document`/`localStorage` and are exercised manually via the preview build (Task 10). All DOM access is inside function bodies so the module stays importable under the `node` test environment.

- [ ] **Step 1: Append the DOM helpers**

Add to the end of `apps/web/src/lib/theme.ts`:

```typescript
function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isMode(stored)) return stored;
  } catch {
    // localStorage can throw in private mode; fall through to default.
  }
  return 'system';
}

export function setStoredMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore; persistence is best-effort for guests.
  }
}

export function applyResolved(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function applyMode(mode: ThemeMode): void {
  applyResolved(resolveMode(mode, prefersDark()));
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: mode }));
}
```

- [ ] **Step 2: Verify the existing tests still pass (module still imports cleanly)**

Run: `cd apps/web && npx vitest run src/lib/theme.test.ts`
Expected: PASS — the 6 assertions remain green (no DOM accessed at import time).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/theme.ts
git commit -m "feat(web): add theme persistence and apply helpers"
```

---

## Task 4: Recolor the token system in `global.css`

**Files:**
- Modify: `apps/web/src/styles/global.css:6-117`

- [ ] **Step 1: Add the success/warn color tokens to the `@theme inline` block**

In `apps/web/src/styles/global.css`, inside `@theme inline { … }`, add after `--color-destructive: var(--destructive);` (line 28):

```css
  --color-destructive: var(--destructive);
  --color-success: var(--success);
  --color-warn: var(--warn);
```

- [ ] **Step 2: Replace the `:root` block with the two-layer palette**

Replace the entire `:root { … }` block (lines 50-83) with:

```css
:root {
  /* ---- Raw scales (leerobert.ca palette; do not use directly in app code) ---- */
  --blue-50:  #EEF4FB;
  --blue-100: #D6E4F4;
  --blue-200: #AEC9E9;
  --blue-300: #82AADC;
  --blue-400: #5C8ECB;
  --blue-500: #3572B9;
  --blue-600: #2A5C99;
  --blue-700: #214779;
  --blue-800: #19355C;
  --blue-900: #112440;

  --slate-0:   #FFFFFF;
  --slate-50:  #F7F9FC;
  --slate-100: #EEF1F6;
  --slate-200: #DCE2EC;
  --slate-300: #BCC5D4;
  --slate-400: #8E99AC;
  --slate-500: #64708A;
  --slate-600: #475067;
  --slate-700: #2F374A;
  --slate-800: #1C2231;
  --slate-900: #0E121C;

  --success: #2E9D6A;
  --warn:    #C98415;
  --danger:  #C24545;

  color-scheme: light;

  /* ---- Semantic tokens (light) ---- */
  --background: var(--slate-0);
  --foreground: var(--slate-900);
  --card: var(--slate-0);
  --card-foreground: var(--slate-900);
  --popover: var(--slate-0);
  --popover-foreground: var(--slate-900);
  --primary: var(--blue-500);
  --primary-foreground: var(--slate-0);
  --secondary: var(--slate-100);
  --secondary-foreground: var(--slate-900);
  --muted: var(--slate-100);
  --muted-foreground: var(--slate-600);
  --accent: var(--slate-100);
  --accent-foreground: var(--slate-900);
  --destructive: var(--danger);
  --border: var(--slate-200);
  --input: var(--slate-200);
  --ring: var(--blue-400);
  --chart-1: var(--blue-300);
  --chart-2: var(--blue-400);
  --chart-3: var(--blue-500);
  --chart-4: var(--blue-600);
  --chart-5: var(--blue-700);
  --radius: 0.625rem;
  --sidebar: var(--slate-50);
  --sidebar-foreground: var(--slate-900);
  --sidebar-primary: var(--blue-500);
  --sidebar-primary-foreground: var(--slate-0);
  --sidebar-accent: var(--slate-100);
  --sidebar-accent-foreground: var(--slate-900);
  --sidebar-border: var(--slate-200);
  --sidebar-ring: var(--blue-400);
}
```

- [ ] **Step 3: Replace the `.dark` block with dark semantic overrides**

Replace the entire `.dark { … }` block (lines 85-117) with:

```css
.dark {
  color-scheme: dark;

  --background: var(--slate-900);
  --foreground: var(--slate-50);
  --card: var(--slate-800);
  --card-foreground: var(--slate-50);
  --popover: var(--slate-800);
  --popover-foreground: var(--slate-50);
  --primary: var(--blue-400);
  --primary-foreground: var(--slate-900);
  --secondary: var(--slate-700);
  --secondary-foreground: var(--slate-50);
  --muted: var(--slate-700);
  --muted-foreground: var(--slate-300);
  --accent: var(--slate-700);
  --accent-foreground: var(--slate-50);
  --destructive: var(--danger);
  --border: var(--slate-700);
  --input: var(--slate-700);
  --ring: var(--blue-400);
  --chart-1: var(--blue-300);
  --chart-2: var(--blue-400);
  --chart-3: var(--blue-500);
  --chart-4: var(--blue-600);
  --chart-5: var(--blue-700);
  --sidebar: var(--slate-800);
  --sidebar-foreground: var(--slate-50);
  --sidebar-primary: var(--blue-400);
  --sidebar-primary-foreground: var(--slate-900);
  --sidebar-accent: var(--slate-700);
  --sidebar-accent-foreground: var(--slate-50);
  --sidebar-border: var(--slate-700);
  --sidebar-ring: var(--blue-400);
}
```

- [ ] **Step 4: Verify the build still compiles the CSS**

Run: `npx nx build web`
Expected: build succeeds (Tailwind resolves the tokens; no unknown-variable errors).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles/global.css
git commit -m "feat(web): adopt leerobert palette via two-layer theme tokens"
```

---

## Task 5: No-flash inline script + base tokens in `Base.astro`

**Files:**
- Modify: `apps/web/src/layouts/Base.astro`

- [ ] **Step 1: Add the frontmatter import and profile-theme read**

Replace the frontmatter (lines 1-4) of `apps/web/src/layouts/Base.astro` with:

```astro
---
import '@fontsource-variable/jetbrains-mono';
import '../styles/global.css';
import { THEME_STORAGE_KEY } from '../lib/theme';

const profileTheme = Astro.locals.user?.theme ?? null;
---
```

(On the prerendered landing page `Astro.locals.user` is undefined at build time; the optional chain yields `null`, which is correct — guests resolve from `localStorage`.)

- [ ] **Step 2: Add the inline no-flash script to `<head>`**

In the `<head>`, after the `<meta name="description" …>` tag (line 12), add:

```astro
    <meta name="description" content="Game server portal for the voz.gg community." />
    <script is:inline define:vars={{ profileTheme, storageKey: THEME_STORAGE_KEY }}>
      (function () {
        try {
          var stored = null;
          try { stored = localStorage.getItem(storageKey); } catch (e) {}
          var valid = function (v) { return v === 'light' || v === 'dark' || v === 'system'; };
          var mode = valid(profileTheme) ? profileTheme : valid(stored) ? stored : 'system';
          // Profile preference wins: keep localStorage in sync when it differs.
          if (valid(profileTheme) && profileTheme !== stored) {
            try { localStorage.setItem(storageKey, mode); } catch (e) {}
          }
          var mql = window.matchMedia('(prefers-color-scheme: dark)');
          var apply = function () {
            var current = mode;
            try { current = localStorage.getItem(storageKey) || mode; } catch (e) {}
            var resolved = current === 'dark' || (current !== 'light' && mql.matches) ? 'dark' : 'light';
            var root = document.documentElement;
            root.classList.toggle('dark', resolved === 'dark');
            root.style.colorScheme = resolved;
          };
          apply();
          mql.addEventListener('change', function () {
            var current = mode;
            try { current = localStorage.getItem(storageKey) || mode; } catch (e) {}
            if (current === 'system') apply();
          });
        } catch (e) {}
      })();
    </script>
```

This runs synchronously before first paint, applies the resolved theme, and keeps a persistent listener so System mode tracks live OS changes (macOS auto) while ignoring them under explicit Light/Dark.

- [ ] **Step 3: Apply base tokens to `<body>`**

Change the `<body>` tag (line 14) from:

```astro
  <body class="font-mono">
```

to:

```astro
  <body class="font-mono bg-background text-foreground">
```

- [ ] **Step 4: Verify the build compiles**

Run: `npx nx build web`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/layouts/Base.astro
git commit -m "feat(web): apply theme before paint via inline head script"
```

---

## Task 6: `ThemeToggle` island

**Files:**
- Create: `apps/web/src/components/ThemeToggle.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/ThemeToggle.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Monitor, Sun, Moon } from 'lucide-react';
import { toast } from 'sonner';
import { authClient } from '../lib/auth-client';
import { cn } from '../lib/utils';
import {
  type ThemeMode,
  THEME_CHANGE_EVENT,
  getStoredMode,
  setStoredMode,
  applyMode,
} from '../lib/theme';

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Monitor }[] = [
  { mode: 'system', label: 'System', Icon: Monitor },
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
];

export default function ThemeToggle() {
  const { data: session } = authClient.useSession();
  const [mode, setMode] = useState<ThemeMode>('system');

  useEffect(() => {
    setMode(getStoredMode());
    const onChange = (e: Event) => setMode((e as CustomEvent<ThemeMode>).detail);
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  async function choose(next: ThemeMode) {
    setMode(next);
    setStoredMode(next);
    applyMode(next);
    if (session?.user) {
      const { error } = await authClient.updateUser({ theme: next });
      if (error) toast.error(error.message ?? 'Could not save theme preference.');
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      {OPTIONS.map(({ mode: optionMode, label, Icon }) => (
        <button
          key={optionMode}
          type="button"
          role="radio"
          aria-checked={mode === optionMode}
          title={label}
          onClick={() => choose(optionMode)}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-[min(var(--radius-md),8px)] text-muted-foreground transition-colors hover:text-foreground',
            mode === optionMode && 'bg-muted text-foreground',
          )}
        >
          <Icon className="size-4" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
```

Login state is read client-side via `authClient.useSession()` so persistence to the profile works on every page, including the prerendered landing page. Plain `<button>`s (not `Button`) avoid the Base UI `useRender`/`data-slot` hydration gotcha noted in AGENTS.md.

- [ ] **Step 2: Verify the build compiles**

Run: `npx nx build web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ThemeToggle.tsx
git commit -m "feat(web): add theme toggle island"
```

---

## Task 7: Sync the Sonner toaster with the active theme

**Files:**
- Modify: `apps/web/src/components/ui/sonner.tsx:1-11`

- [ ] **Step 1: Drive the toaster theme from the active `dark` class**

Replace lines 1-11 of `apps/web/src/components/ui/sonner.tsx` with:

```tsx
"use client"

import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { THEME_CHANGE_EVENT } from "../../lib/theme"

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = React.useState<"light" | "dark">("dark")

  React.useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light")
    read()
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    window.addEventListener(THEME_CHANGE_EVENT, read)
    mql.addEventListener("change", read)
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, read)
      mql.removeEventListener("change", read)
    }
  }, [])

  return (
    <Sonner
      theme={theme}
      className="toaster group"
```

(The rest of the component — `icons`, `style`, `toastOptions`, `{...props}` — is unchanged. Delete the old `theme="dark"` line that previously sat under `<Sonner`.)

- [ ] **Step 2: Verify the build compiles**

Run: `npx nx build web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/sonner.tsx
git commit -m "feat(web): sync toaster theme with active theme"
```

---

## Task 8: Recolor and mount the toggle in the app chrome

**Files:**
- Modify: `apps/web/src/layouts/Dashboard.astro`
- Modify: `apps/web/src/pages/index.astro`
- Modify: `apps/web/src/pages/sign-in.astro`

- [ ] **Step 1: Recolor `Dashboard.astro` and add the toggle to the header**

In `apps/web/src/layouts/Dashboard.astro`:

Add the import after line 4:

```astro
import { Toaster } from '../components/ui/sonner.tsx';
import ThemeToggle from '../components/ThemeToggle.tsx';
```

Replace the markup (lines 15-42) with:

```astro
<Base>
  <div class="flex min-h-screen bg-background text-foreground">
    <aside class="hidden w-60 shrink-0 border-r border-border md:block">
      <nav class="flex flex-col gap-1 p-4">
        <a href="/" class="mb-6 px-2 py-1 text-2xl font-bold tracking-tight text-foreground">voz.gg</a>
        {nav.map((item) => (
          <a
            href={item.href}
            class:list={[
              'rounded-md px-3 py-2 text-sm transition-colors',
              isActive(item.href)
                ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            ]}
          >{item.label}</a>
        ))}
      </nav>
    </aside>
    <div class="flex flex-1 flex-col">
      <header class="flex items-center justify-end gap-3 border-b border-border px-6 py-3 text-sm">
        <span class="text-muted-foreground">{label}</span>
        <ThemeToggle client:load />
        <SignOut client:load />
      </header>
      <main class="flex-1 p-6 md:p-10"><slot /></main>
    </div>
    <Toaster client:load position="bottom-right" />
  </div>
</Base>
```

(The wordmark glow `style="text-shadow…"` is removed, the cyan accents become `primary`, and `<Toaster>` no longer hardcodes `theme="dark"`.)

- [ ] **Step 2: Recolor `index.astro` and add a fixed top-right toggle**

In `apps/web/src/pages/index.astro`:

Add the import after line 4 (`import Base from '../layouts/Base.astro';`):

```astro
import ThemeToggle from '../components/ThemeToggle.tsx';
```

Replace the `<main>` markup (lines 15-65) with:

```astro
<Base>
  <main class="min-h-screen flex flex-col md:flex-row bg-background text-foreground">
    <div class="fixed right-4 top-4 z-50">
      <ThemeToggle client:load />
    </div>
    <div class="flex-1 flex flex-col items-center justify-center gap-6 p-12">
      <h1 class="text-8xl font-bold tracking-tight">voz.gg</h1>
      <p class="text-lg text-muted-foreground">
        Game servers hosted by Voz for 1LD, WTK, & friends.
      </p>
      <a href="/sign-in" class="mt-2 rounded border border-primary text-primary hover:bg-primary/10 px-6 py-2 font-semibold transition-colors">Sign In</a>
    </div>
    <div
      class="hidden md:flex flex-1 items-center justify-center bg-card border-l border-border"
    >
      <svg width="220" height="260" viewBox="0 0 220 260" fill="none" aria-hidden="true">
        {
          dots.map((dot) => (
            <circle
              cx={dot.cx}
              cy={dot.cy}
              r="3"
              fill="var(--primary)"
              style={`animation: dot-pulse 2s ease-in-out infinite; animation-delay: ${dot.delay}ms;`}
            />
          ))
        }
        {
          racks.map((rackIndex) => (
            <g transform={`translate(0, ${178 + rackIndex * 26})`}>
              <rect
                x="10"
                y="0"
                width="160"
                height="18"
                rx="3"
                fill="var(--muted)"
                stroke="var(--border)"
                stroke-width="1"
              />
              <circle
                cx="182"
                cy="9"
                r="4"
                fill="var(--success)"
                style={`animation: dot-pulse 3s ease-in-out infinite; animation-delay: ${rackIndex * 600}ms;`}
              />
            </g>
          ))
        }
      </svg>
    </div>
  </main>
</Base>
```

(The `<style is:global>` keyframes block below stays unchanged.)

- [ ] **Step 3: Recolor `sign-in.astro` and add a fixed top-right toggle**

Replace `apps/web/src/pages/sign-in.astro` entirely with:

```astro
---
export const prerender = false;
import Base from '../layouts/Base.astro';
import SignIn from '../components/SignIn.tsx';
import ThemeToggle from '../components/ThemeToggle.tsx';
if (Astro.locals.user) return Astro.redirect('/dashboard');
---
<Base>
  <main class="min-h-screen flex flex-col items-center justify-center gap-8 bg-background text-foreground p-12">
    <div class="fixed right-4 top-4 z-50">
      <ThemeToggle client:load />
    </div>
    <h1 class="text-4xl font-bold tracking-tight">voz.gg</h1>
    <SignIn client:load />
  </main>
</Base>
```

- [ ] **Step 4: Verify the build compiles**

Run: `npx nx build web`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/layouts/Dashboard.astro apps/web/src/pages/index.astro apps/web/src/pages/sign-in.astro
git commit -m "feat(web): recolor app chrome to tokens and mount theme toggle"
```

---

## Task 9: Recolor the remaining dashboard components and pages

Apply the cheat-sheet at the top of this plan. Brand OAuth colors in `SignIn.tsx` stay.

**Files:**
- Modify: `apps/web/src/pages/dashboard/profile.astro`
- Modify: `apps/web/src/pages/dashboard/servers.astro`
- Modify: `apps/web/src/components/SignIn.tsx`
- Modify: `apps/web/src/components/dashboard/ProfileForm.tsx`
- Modify: `apps/web/src/components/dashboard/MinecraftField.tsx`
- Modify: `apps/web/src/components/dashboard/SteamLinkCard.tsx`
- Modify: `apps/web/src/components/dashboard/StatusBadge.tsx`

- [ ] **Step 1: Recolor `profile.astro`**

In `apps/web/src/pages/dashboard/profile.astro`: `text-white/40` → `text-muted-foreground`; each `<Card className="border-[#1a1a2e] bg-[#0d0d14]">` → `<Card className="border-border bg-card">`; each `<CardTitle className="text-white">` → `<CardTitle className="text-foreground">`; each `<CardDescription className="text-white/40">` → `<CardDescription className="text-muted-foreground">`.

- [ ] **Step 2: Recolor `servers.astro`**

In `apps/web/src/pages/dashboard/servers.astro`: `text-white/40` → `text-muted-foreground`; `<Card className="border-[#1a1a2e] bg-[#0d0d14]">` → `border-border bg-card`; the empty-state `CardContent` `text-white/40` → `text-muted-foreground`; table wrapper `border border-[#1a1a2e] bg-[#0d0d14]` → `border border-border bg-card`; `<thead class="bg-[#0a0a0f] … text-white/40">` → `bg-muted … text-muted-foreground`; row `border-t border-[#1a1a2e]` → `border-t border-border`; server name `text-white` → `text-foreground`; the description and the two `text-white/70` cells → `text-muted-foreground`.

- [ ] **Step 3: Recolor `SignIn.tsx` (keep OAuth brand colors)**

In `apps/web/src/components/SignIn.tsx`: leave the Discord button (`bg-[#5865F2]`) and the Google button (`bg-white text-black`) unchanged. Change the magic-link input `bg-[#1a1a2e]` → `bg-muted`; the submit button `border-[#00e5ff] text-[#00e5ff]` → `border-primary text-primary`; the sent confirmation `text-[#00ff88]` → `text-success`.

- [ ] **Step 4: Recolor `ProfileForm.tsx`**

In `apps/web/src/components/dashboard/ProfileForm.tsx`: both `<Label … className="text-white/70">` → `text-muted-foreground`; the `Input` `className="bg-[#0a0a0f] text-white"` → `bg-background text-foreground`; the textarea `className` — change `bg-[#0a0a0f]` → `bg-background` and `text-white` → `text-foreground` (keep the existing `border-input`/`focus-visible` classes).

- [ ] **Step 5: Recolor `MinecraftField.tsx`**

In `apps/web/src/components/dashboard/MinecraftField.tsx`: the checking spinner `text-white/40` → `text-muted-foreground`; the `Label` `text-white/70` → `text-muted-foreground`; the avatar `ring-[#1a1a2e]` → `ring-border`; the placeholder block `bg-[#1a1a2e]` → `bg-muted`; the `Input` `bg-[#0a0a0f] text-white` → `bg-background text-foreground`.

- [ ] **Step 6: Recolor `SteamLinkCard.tsx`**

In `apps/web/src/components/dashboard/SteamLinkCard.tsx`: both rows `border border-[#1a1a2e] bg-[#0a0a0f]` → `border border-border bg-background`; the `<p className="text-sm text-white">` (both) → `text-foreground`; the `text-white/40` / `text-xs text-white/40` descriptions → `text-muted-foreground`; avatar `ring-[#1a1a2e]` → `ring-border`; placeholder `bg-[#1a1a2e]` → `bg-muted`.

- [ ] **Step 7: Recolor `StatusBadge.tsx`**

In `apps/web/src/components/dashboard/StatusBadge.tsx`: `className="border-white/15 bg-white/5 text-white/60"` → `className="border-border bg-muted text-muted-foreground"`.

- [ ] **Step 8: Verify no stray hardcoded colors remain (except exempt brand colors)**

Run: `cd apps/web/src && rg -n 'text-white|bg-white|#0a0a0f|#0d0d14|#1a1a2e|#00e5ff|#00ff88|#2a2a3e' --glob '*.tsx' --glob '*.astro'`
Expected: only the two exempt OAuth brand lines in `components/SignIn.tsx` (Discord `#5865F2` is not in this pattern; Google `bg-white text-black`) — i.e. the single `bg-white text-black` match on the Google button. Nothing else.

- [ ] **Step 9: Verify the build compiles**

Run: `npx nx build web`
Expected: build succeeds.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/dashboard apps/web/src/components
git commit -m "feat(web): recolor dashboard components to theme tokens"
```

---

## Task 10: Design-system documentation

**Files:**
- Create: `apps/web/docs/design-system.md`
- Modify: `apps/web/src/styles/global.css` (header comment)

- [ ] **Step 1: Add a documented header to `global.css`**

At the very top of `apps/web/src/styles/global.css`, before `@import "tailwindcss";`, add:

```css
/* =============================================================
   voz.gg — Design System tokens
   Two layers:
     1. Raw scales (--blue-*, --slate-*) — the leerobert.ca
        palette. Never reference these directly in app code.
     2. Semantic tokens (--background, --primary, ...) — mapped
        onto the scales, exposed to Tailwind via @theme inline as
        bg-background / text-foreground / etc. USE THESE.
   Dark mode is the `.dark` class on <html>, set before paint by
   the inline script in Base.astro. Full reference:
   apps/web/docs/design-system.md
   ============================================================= */
```

- [ ] **Step 2: Write `apps/web/docs/design-system.md`**

Create `apps/web/docs/design-system.md`:

```markdown
# voz.gg Design System

## Colors

Colors are defined in two layers in `src/styles/global.css`:

1. **Raw scales** — `--blue-50…900`, `--slate-0…900`, plus `--success`,
   `--warn`, `--danger`. These are the leerobert.ca palette (primary blue
   `#3572B9`, cool slate neutrals). **Do not reference raw scales in app code.**
2. **Semantic tokens** — `--background`, `--foreground`, `--card`, `--primary`,
   `--muted`, `--border`, etc. — mapped onto the scales and exposed to Tailwind
   through `@theme inline` as utilities (`bg-background`, `text-foreground`,
   `text-primary`, `border-border`, `text-success`, …).

**Rule: use semantic token utilities, never raw hex.** A hardcoded hex value
(e.g. `bg-[#0a0a0f]`, `text-white`) is a bug — it will not respond to theme
changes. The only exemptions are third-party brand colors (the Discord and
Google sign-in buttons).

| Semantic token | Light | Dark |
|---|---|---|
| background / foreground | white / slate-900 | slate-900 / slate-50 |
| card, popover | white / slate-900 | slate-800 / slate-50 |
| primary | blue-500 | blue-400 |
| muted / muted-foreground | slate-100 / slate-600 | slate-700 / slate-300 |
| border, input | slate-200 | slate-700 |
| destructive | danger | danger |
| success | `#2E9D6A` | `#2E9D6A` |

## Theming

Three modes: **System**, **Light**, **Dark** (`ThemeMode` in `src/lib/theme.ts`).

- **Mechanism:** the `dark` class on `<html>` toggles dark mode (Tailwind
  `@custom-variant dark`). `color-scheme` is set alongside for native controls.
- **System mode** follows `prefers-color-scheme` and updates live when the OS
  flips (including macOS day/night auto). Explicit Light/Dark ignore the OS.
- **No flash:** an inline `<head>` script in `Base.astro` sets the class before
  first paint, reading (in order) the logged-in user's saved `theme`, then
  `localStorage`, then defaulting to System.
- **Persistence & precedence:** guests persist to `localStorage`
  (`voz-theme`); logged-in users persist to their profile via
  `authClient.updateUser({ theme })`. **The profile value overrides
  `localStorage`** — when set, it is mirrored back into `localStorage` on load.
- **Control:** the `ThemeToggle` island (`src/components/ThemeToggle.tsx`) is
  mounted in the dashboard header and top-right on guest pages.

## Radii, spacing, typography

Unchanged by the theme work — see the `@theme inline` / `:root` blocks in
`global.css`. The app font is JetBrains Mono.
```

- [ ] **Step 3: Verify the build still compiles**

Run: `npx nx build web`
Expected: build succeeds (the comment is inert).

- [ ] **Step 4: Commit**

```bash
git add apps/web/docs/design-system.md apps/web/src/styles/global.css
git commit -m "docs(web): document the design system and theming"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run: `npx nx test web`
Expected: PASS — including the `theme.test.ts` suite.

- [ ] **Step 2: Lint**

Run: `npx nx lint web`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npx nx build web`
Expected: build succeeds.

- [ ] **Step 4: Manual preview checklist**

Run: `npx nx run web:preview` and verify in a browser:

- Hard-reload on the landing page in each mode → **no flash** of the wrong theme.
- Toggle System/Light/Dark on the landing page → colors switch immediately; the toggle reflects the active mode.
- In System mode, change the OS appearance (macOS System Settings → Appearance, or devtools "Emulate CSS prefers-color-scheme") → the page follows live without reload. In explicit Light/Dark, the OS change is ignored.
- Sign in; change the theme from the dashboard header → a toast confirms or the change persists silently; reload → the choice sticks (profile value).
- As a logged-in user, set Dark in the profile, then in another tab (signed out) set Light via `localStorage` → on reload of a signed-in page the **profile (Dark) wins**.
- Toasts (trigger one via a profile save) match the active theme.

- [ ] **Step 5: Final review commit (if any checklist fixes were needed)**

```bash
git add -A
git commit -m "fix(web): address theme preview checklist findings"
```

(Skip if the checklist passed with no changes.)

---

## Self-review notes

- **Spec coverage:** modes/System-auto (Task 5 script + Task 2 `resolveMode`); no-flash (Task 5); precedence (Task 2 `resolveInitialMode` + Task 5 script + Task 6 persistence); localStorage/profile persistence + `theme` column (Tasks 1, 3, 6); header-everywhere control (Tasks 6, 8); full recolor incl. leerobert palette and glow removal (Tasks 4, 8, 9); design-system docs (Task 10); tests (Task 2, 11). All spec sections map to a task.
- **Type consistency:** `ThemeMode`/`ResolvedTheme`, `THEME_STORAGE_KEY`, `THEME_CHANGE_EVENT`, `resolveMode`, `resolveInitialMode`, `getStoredMode`, `setStoredMode`, `applyMode`, `applyResolved` are defined in Tasks 2–3 and used with identical names in Tasks 5–7.
- **No placeholders:** every code step contains the full content to write.
```
