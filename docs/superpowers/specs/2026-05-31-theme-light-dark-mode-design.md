# Light / Dark / System Theme — Design

**Date:** 2026-05-31
**Status:** Proposed
**Scope:** `apps/web` (Astro SSR frontend), `libs/shared` (Drizzle schema)

## Summary

Add user-selectable theming with three modes — **System**, **Light**, **Dark** —
to the voz.gg web app. System follows the OS preference (including macOS
time-of-day "auto") and updates live when the OS flips, unless the user has
explicitly chosen Light or Dark. The preference persists to `localStorage` for
guests and to the user profile (Cloudflare D1) for logged-in users; the profile
value overrides `localStorage`.

This also includes a **full recolor** of the app from hardcoded hex values to
theme tokens, so Light mode renders correctly everywhere, and **design-system
documentation** so the token system is discoverable and regressions (raw hex)
are easy to spot.

## Goals

- Three modes: System / Light / Dark, switchable from a header control on every
  page (dashboard, landing, sign-in).
- No flash of the wrong theme on first paint (FOUC), for guests and logged-in
  users alike.
- System mode tracks live OS changes (including macOS auto day/night); explicit
  Light/Dark ignores OS changes.
- Persist to `localStorage` (guests) and user profile (logged-in). Profile wins.
- Recolor the app to the leerobert.ca palette via theme tokens; remove glow
  effects.
- Document the design system in-repo.

## Non-goals

- No change to radii, spacing, or typography — **colors only** adopt the
  leerobert.ca palette.
- No cookie-based SSR theming (a possible future enhancement; see Alternatives).
- No per-component theme overrides or additional accent themes.

## Decisions (confirmed)

1. **Mechanism + full recolor.** Build the switching infrastructure *and*
   migrate hardcoded dashboard/landing colors to tokens.
2. **Header control, everywhere.** Toggle reachable from every page.
3. **Unify accent on the blue `--primary` token.** The bespoke cyan `#00e5ff`
   is dropped. **This changes dark mode too** — the dashboard's current cyan
   accents become blue.
4. **Use the leerobert.ca colors** — primary blue `#3572B9` / `#5C8ECB`, cool
   slate neutrals, and its success/warn/danger semantics.
5. **Remove glow effects entirely** (wordmark `text-shadow`, ring glows).
6. **Keep voz.gg's `.dark` class mechanism** (not leerobert's `data-theme`),
   so existing shadcn `dark:` variants keep working. Only color *values* are
   adopted.
7. **Document the design system** in-repo.

## Theme model

- **Mode** (stored preference): `"system" | "light" | "dark"`. Default
  `"system"`.
- **Resolved theme** (what is applied): `"light" | "dark"`.
  - In `system` mode, resolved = `matchMedia("(prefers-color-scheme: dark)")`.
  - In `light`/`dark` mode, resolved = the mode itself.
- Applying a theme = toggling the `dark` class on `<html>`
  (`document.documentElement.classList`).

### macOS auto / live OS changes

No special handling is needed beyond a media-query listener. macOS "auto" flips
the OS-level `prefers-color-scheme`, which fires a `change` event on
`matchMedia("(prefers-color-scheme: dark)")`. While the mode is `system`, the
listener re-resolves and re-applies. When the mode is explicit `light`/`dark`,
the listener ignores the event.

## Precedence (profile overrides localStorage)

Resolution order for the initial mode:

1. **Logged-in with a saved `theme`** → profile value wins. The client also
   syncs it into `localStorage` so the two stay consistent.
2. **Logged-in with `theme` null/absent** → fall back to `localStorage` → then
   `system`.
3. **Guest** → `localStorage` → then `system`.

Edge cases:

- Guest picks Dark, then logs into an account whose profile is Light → on the
  next SSR the server embeds Light, the inline script applies Light, and
  `localStorage` is overwritten to Light. Profile wins.
- `localStorage` throws (private mode / quota) → caught, treated as `system`.

## Architecture (Approach A: inline head script + class toggle)

### No-flash inline script (`Base.astro`, in `<head>`, runs before paint)

A small synchronous (non-module) inline script that:

1. Determines the initial mode: server-embedded profile value (logged-in) →
   else `localStorage.theme` → else `"system"`.
2. Resolves `system` via `matchMedia` and sets/removes the `dark` class on
   `<html>` and sets `color-scheme` synchronously, before first paint.
3. Registers a persistent `matchMedia` `change` listener that re-applies only
   while the current mode is `system`.
4. Entire body wrapped in `try/catch` → falls back to `system`/light on error.

The logged-in profile value is embedded server-side by `Base.astro` reading
`Astro.locals.user?.theme`. The script source lives in `theme.ts` as a string
constant so it has one source of truth and can be unit-reasoned about; it is
injected with `<script is:inline set:html={THEME_INIT_SCRIPT}>`.

### Runtime helpers (`apps/web/src/lib/theme.ts`)

Framework-agnostic, pure where possible, unit-tested:

- `type ThemeMode = "system" | "light" | "dark"`
- `type ResolvedTheme = "light" | "dark"`
- `resolveMode(mode, prefersDark: boolean): ResolvedTheme` — pure.
- `resolveInitialMode({ profileTheme, storedTheme }): ThemeMode` — pure
  precedence resolver.
- `getStoredMode(): ThemeMode` / `setStoredMode(mode)` — `localStorage`, guarded.
- `applyTheme(resolved: ResolvedTheme)` — toggles the `dark` class +
  `color-scheme`.
- `subscribeSystem(cb): () => void` — wraps the `matchMedia` listener.
- `THEME_INIT_SCRIPT: string` — the inline head script source.
- `THEME_STORAGE_KEY = "voz-theme"`.

### Theme toggle island (`apps/web/src/components/ThemeToggle.tsx`)

A `@astrojs/react` island (`client:load`) rendering a 3-way control
(System / Light / Dark) built from Base UI primitives, styled with CVA classes
(respecting the AGENTS.md hydration gotcha — no Base UI component nested in
another's `render` prop).

On mount it reads the current mode. On change it:

1. Writes `localStorage` and applies the resolved theme immediately.
2. Dispatches a `themechange` `CustomEvent` so the inline listener and any other
   toggle instance stay in sync.
3. If logged in, persists via `authClient.updateUser({ theme })` (same pattern
   as `ProfileForm`). On failure → error toast; the local change is retained
   (optimistic).

Whether the user is logged in is passed as a prop from the Astro layout
(`Astro.locals.user != null`).

### Placement

- **Dashboard** (`Dashboard.astro`): inline in the existing header.
- **Guest pages** (`index.astro`, `sign-in.astro`): a fixed top-right instance
  of the same component (these layouts have no header).

## Persistence

- **Schema** (`libs/shared/src/schema.ts`): add a nullable `theme` text column
  to the `user` table. No default (null = "not set" = fall through precedence).
- **Migration:** `cd apps/web && npx drizzle-kit generate`; apply with
  `npx wrangler d1 migrations apply voz-gg --local` (and `--remote` for prod).
- **Better-auth** (`apps/web/src/lib/auth.ts`): add `theme` to
  `user.additionalFields` as `{ type: "string", required: false, input: true }`
  so `authClient.updateUser({ theme })` is accepted.

## Color system (leerobert.ca palette → shadcn tokens)

`global.css` gains a **two-layer** structure mirroring leerobert.ca:

**Layer 1 — raw scales** (exact leerobert.ca hex):

- `--blue-50..900`: `#EEF4FB #D6E4F4 #AEC9E9 #82AADC #5C8ECB #3572B9 #2A5C99 #214779 #19355C #112440`
- `--slate-0..900`: `#FFFFFF #F7F9FC #EEF1F6 #DCE2EC #BCC5D4 #8E99AC #64708A #475067 #2F374A #1C2231 #0E121C`
- semantics: `--success #2E9D6A`, `--warn #C98415`, `--danger #C24545`

**Layer 2 — shadcn semantic tokens** mapped onto the scales (light `:root` /
dark `.dark`):

| Token | Light | Dark |
|---|---|---|
| `--background` | slate-0 | slate-900 |
| `--foreground` | slate-900 | slate-50 |
| `--card` | slate-0 | slate-800 |
| `--card-foreground` | slate-900 | slate-50 |
| `--popover` | slate-0 | slate-800 |
| `--popover-foreground` | slate-900 | slate-50 |
| `--primary` | blue-500 | blue-400 |
| `--primary-foreground` | slate-0 | slate-900 |
| `--secondary` | slate-100 | slate-700 |
| `--secondary-foreground` | slate-900 | slate-50 |
| `--muted` | slate-100 | slate-700 |
| `--muted-foreground` | slate-600 | slate-300 |
| `--accent` | slate-100 | slate-700 |
| `--accent-foreground` | slate-900 | slate-50 |
| `--destructive` | danger (`#C24545`) | danger (`#C24545`) |
| `--border` | slate-200 | slate-700 |
| `--input` | slate-200 | slate-700 |
| `--ring` | blue-400 | blue-400 |
| `--chart-1..5` | blue-300/400/500/600/700 | blue-300/400/500/600/700 |
| `--sidebar` | slate-50 | slate-800 |
| `--sidebar-foreground` | slate-900 | slate-50 |
| `--sidebar-primary` | blue-500 | blue-400 |
| `--sidebar-primary-foreground` | slate-0 | slate-900 |
| `--sidebar-accent` | slate-100 | slate-700 |
| `--sidebar-accent-foreground` | slate-900 | slate-50 |
| `--sidebar-border` | slate-200 | slate-700 |
| `--sidebar-ring` | blue-400 | blue-400 |

- `--radius` and the radius scale: **unchanged** (voz.gg keeps its current
  values).
- Add `color-scheme: light;` to `:root` and `color-scheme: dark;` to `.dark`
  for correct native controls/scrollbars.
- Online/"up" status indicators use `--success` (replaces `#00ff88`).

### Recolor targets (hardcoded hex → tokens)

- `Base.astro`: `<body>` → `bg-background text-foreground` (+ font).
- `Dashboard.astro`: replace `bg-[#0a0a0f]`, `text-white`, `border-[#1a1a2e]`,
  `#00e5ff` active/hover states, and the wordmark glow `text-shadow` with
  `bg-background`, `text-foreground`, `border-border`,
  `bg-primary/10 text-primary ring-primary/30`, `text-muted-foreground`. Sonner
  `<Toaster>` `theme="dark"` → driven by the resolved theme.
- `index.astro` (landing): bg/text/accent → tokens; the "Sign In" button
  `#00e5ff` → primary; SVG dots `fill="#00e5ff"` → `currentColor` /
  `var(--primary)`; rack `#1a1a2e` → a muted token; status dot `#00ff88` →
  `var(--success)`; remove glow.
- `sign-in.astro`: bg/text → tokens.

## Documentation deliverable

- **`global.css`**: a documented header (like leerobert.ca's `tokens.css`)
  explaining the two-layer structure and the `.dark` mechanism.
- **`apps/web/docs/design-system.md`**: concise reference — the palette, the
  raw→semantic token mapping, the `.dark` class mechanism, the theme-switching
  flow (modes, precedence, no-flash), and the rule **"use tokens, never raw
  hex."**

## Error handling

- `localStorage` access wrapped in `try/catch` → `system` fallback.
- `matchMedia` absent → guard; treat as light.
- `authClient.updateUser` failure → error toast; local applied state retained;
  next change retries the sync.

## Testing

- **Vitest unit tests** for `theme.ts` pure functions:
  - `resolveMode` against mocked `prefersDark` true/false.
  - `resolveInitialMode` across every combination of profile (set/null) ×
    stored (set/absent) × default.
- **Manual** (`nx run web:preview`): no-flash on hard reload in each mode; live
  OS switch while in System mode; guest→login profile-wins behavior; toggle
  reachable on dashboard, landing, sign-in.

## Alternatives considered

- **React `ThemeProvider` context** — poor fit for Astro islands; still needs
  the inline no-flash script; more hydration surface. Rejected.
- **Cookie-based SSR theme** — server renders the correct class for guests too,
  but System still needs client `matchMedia`, and it adds cookie + middleware
  plumbing. Deferred as a possible future enhancement.

## Files

**New**

- `apps/web/src/lib/theme.ts`
- `apps/web/src/components/ThemeToggle.tsx`
- `apps/web/src/lib/theme.test.ts` (vitest)
- `apps/web/docs/design-system.md`
- Drizzle migration under `apps/web/drizzle/migrations`

**Modified**

- `libs/shared/src/schema.ts` (add `theme` column)
- `apps/web/src/lib/auth.ts` (add `theme` additional field)
- `apps/web/src/styles/global.css` (two-layer palette + docs + `color-scheme`)
- `apps/web/src/layouts/Base.astro` (inline script + body tokens)
- `apps/web/src/layouts/Dashboard.astro` (toggle + recolor + dynamic Toaster)
- `apps/web/src/pages/index.astro` (recolor + toggle)
- `apps/web/src/pages/sign-in.astro` (recolor + toggle)
