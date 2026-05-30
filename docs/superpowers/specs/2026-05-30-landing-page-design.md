---
date: 2026-05-30
feature: Landing Page + Styling Foundation
status: designed
sub_project: 2 of 6 (port-decomposition-roadmap)
---

# voz.gg — Landing Page + Styling Foundation

## Context

Sub-project #2 in the port of `game-server-panel` (Next.js) into the `voz.gg`
Astro + Cloudflare monorepo. The foundation (sub-project #1) is complete: the
`web` app builds and deploys as Astro SSR via `@astrojs/cloudflare`, but it has
**no styling foundation** — no Tailwind, no global CSS, no fonts, no layout. The
current `src/pages/index.astro` is a placeholder stub.

This sub-project bundles two deliverables:

1. The reusable **styling foundation** the entire frontend will sit on.
2. The **landing page** itself — a faithful port of the source page.

The landing page is deliberately **island-free** (pure CSS/SVG, no JavaScript,
no auth dependency), which makes it a clean parallel task that does not block,
and is not blocked by, other sub-projects.

Source page: `~/dev/game-server-panel/src/app/page.tsx`.
Source theme: `~/dev/game-server-panel/src/app/globals.css`.

## Goals

- Establish Tailwind 4 + the OKLch theme so later dashboard sub-projects inherit
  a ready-made theme with no migration.
- Replace the stub landing page with a pixel-faithful port of the source.
- Keep the page prerendered and JavaScript-free.

## Non-goals (explicitly out of scope)

- React / `@astrojs/react` islands, Base UI, shadcn, `tw-animate-css`.
  These arrive with the dashboard sub-projects that actually need them.
- Real authentication / `NavAuth` / WorkOS. The Sign In button is a disabled
  placeholder. Auth is sub-project #3.
- README rewrite. The source spec coupled these; here the README is a separate
  concern, not part of this sub-project.

## A. Styling foundation

Set up once; every later page reuses it.

### Tailwind 4

- Install Tailwind 4 and wire `@tailwindcss/vite` into `apps/web/astro.config.mjs`
  (Astro 6's recommended integration path).
- No `tailwind.config.*` — Tailwind 4 is CSS-configured per AGENTS.md.

### Global stylesheet — `apps/web/src/styles/global.css`

- `@import "tailwindcss";`
- Port the `@theme inline` token mapping and the `:root` / `.dark` OKLch
  variable blocks from the source `globals.css`. Port the **full** theme
  (it is stable and copy-once) so the dashboard inherits it.
- **Omit** until a later sub-project needs them:
  - `@import "tw-animate-css";`
  - `@import "shadcn/tailwind.css";`
  - the sidebar-specific `--color-sidebar-*` mappings may be carried or dropped;
    carrying them is harmless and avoids a later edit. Carry them.

### Font — JetBrains Mono

- Self-host via `@fontsource-variable/jetbrains-mono` (deterministic on
  Cloudflare; no runtime Google Fonts fetch). The source renders the entire
  landing page in mono (`--font-mono` → JetBrains Mono, `body` is `font-mono`).
- Import the font CSS in `Base.astro` and map it to `--font-mono` so the
  `font-mono` utility resolves to JetBrains Mono.

### Base layout — `apps/web/src/layouts/Base.astro`

- The `<html>` / `<head>` / `<body>` shell. Imports `global.css` and the font.
- `<head>`: `lang="en"`, `charset`, viewport, `<title>` and meta description:
  - title: `voz.gg — Your servers. Your community.`
  - description: `Game server portal for the voz.gg community.`
- `<body>` carries the mono font class. The landing page uses explicit hex
  colors, so no `.dark` class is required here; whether the dashboard defaults
  to `.dark` is decided in a later sub-project.
- Exposes a `<slot />` for page content. Reused by every later page.

## B. Landing page — `apps/web/src/pages/index.astro`

- Keeps `export const prerender = true;`.
- Uses `Base.astro`.

### Layout

Full-viewport flex, `flex-col md:flex-row`, background `#0a0a0f`, white text.

- **Left panel** — `flex-1`, vertically + horizontally centered, gap, padding:
  - `voz.gg` wordmark — `text-8xl font-bold tracking-tight`.
  - tagline — `text-lg text-white/40`:
    `Game servers hosted by Voz for 1LD, WTK, & friends.`
  - **Sign In button** — disabled placeholder styled to match the eventual
    real button. No `NavAuth`, no WorkOS.
- **Right panel** — `hidden md:flex flex-1`, centered, background `#0d0d14`,
  `border-l border-[#1a1a2e]`, contains the SVG graphic.

### SVG graphic (ported 1:1)

`<svg width="220" height="260" viewBox="0 0 220 260" aria-hidden="true">`:

- **Dot grid** — 40 circles, 5 columns × 8 rows, `r=3`, fill `#00e5ff`.
  Position: `cx = (i % 5) * 20 + 10`, `cy = floor(i / 5) * 20 + 10`.
  Each animates `dot-pulse 2s ease-in-out infinite` with
  `animation-delay: i * 80ms` (staggered shimmer).
- **Server racks** — 3 groups, each `translate(0, 178 + index * 26)`:
  - bar `rect` `x=10 y=0 w=160 h=18 rx=3` fill `#1a1a2e` stroke `#2a2a3e`.
  - status dot `circle cx=182 cy=9 r=4` fill `#00ff88`, animating
    `dot-pulse 3s ease-in-out infinite` with `animation-delay: index * 600ms`.

The 40 dots and 3 racks may be generated with Astro template loops
(`Array.from`) exactly as the source does, or written out inline — either is
acceptable since the output is static.

### Animation

- `@keyframes dot-pulse` in a scoped `<style>` block in `index.astro`
  (or in `global.css` if reused later). Pure CSS, no JavaScript.
  Faithful to source: opacity/scale pulse.

### Colors (reference)

| token            | value     |
|------------------|-----------|
| page background  | `#0a0a0f` |
| right panel bg   | `#0d0d14` |
| panel border     | `#1a1a2e` |
| rack bar fill    | `#1a1a2e` |
| rack bar stroke  | `#2a2a3e` |
| accent cyan      | `#00e5ff` |
| status green     | `#00ff88` |

## Testing / acceptance

- `nx build web` succeeds.
- `nx run web:preview` (wrangler dev) serves the page locally.
- The dot grid and rack dots animate; the right panel collapses below the `md`
  breakpoint, leaving the left panel full-width.
- The landing page is emitted as static HTML (prerendered) in the build output.
- `nx lint web` passes; no new `@nx/enforce-module-boundaries` violations
  (`web` stays `type:app, lang:ts`, depends only on `type:lib`).
- No JavaScript is shipped for the landing page (island-free).

## Files

| path                                   | action |
|----------------------------------------|--------|
| `apps/web/astro.config.mjs`            | edit — add `@tailwindcss/vite` |
| `apps/web/package.json`                | edit — add tailwind, `@tailwindcss/vite`, `@fontsource-variable/jetbrains-mono` |
| `apps/web/src/styles/global.css`       | create — Tailwind + ported OKLch theme |
| `apps/web/src/layouts/Base.astro`      | create — shared shell |
| `apps/web/src/pages/index.astro`       | replace — landing page port |

## Notes for later sub-projects

- The dashboard sub-projects add `@astrojs/react`, Base UI, shadcn, and
  `tw-animate-css` on top of this foundation. Mind the **Base UI hydration
  gotcha** in AGENTS.md when those land.
- This page sets the visual baseline (colors, mono font) reused across the app.
