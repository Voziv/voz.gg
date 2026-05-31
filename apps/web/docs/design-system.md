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
