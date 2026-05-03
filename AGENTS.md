## Commands

- `pnpm dev` — start development server
- `pnpm build` — production build
- `pnpm start` — start production server
- `pnpm lint` — run ESLint

No test runner is configured yet.

## Architecture

Next.js 16 App Router project with React 19. Source lives in `src/`:

- `src/app/` — App Router pages and layouts (RSC-first)
- `src/components/ui/` — shadcn/ui components (add via `pnpm dlx shadcn add <component>`)
- `src/lib/utils.ts` — `cn()` utility for className merging (clsx + tailwind-merge)

Path alias: `@/` → `src/`

## Tech Notes

**Tailwind CSS 4** — uses `@tailwindcss/postcss`, not the legacy `tailwindcss` PostCSS plugin. CSS variables are defined in OKLch color space in `src/app/globals.css`. No `tailwind.config.*` file — configuration is done in CSS.

**shadcn/ui** — style is `base-vega`, built on Base UI (`@base-ui/react`) primitives rather than Radix. Components use CVA for variants. Configuration in `components.json`.

Don't nest a shadcn Base UI–derived component (`Button`, `Badge`, etc.) inside another Base UI primitive's `render` prop, e.g. `<DialogTrigger render={<Button .../>}>`. Both sides run `useRender` and set `data-slot`; the merge order diverges between SSR and client and produces a hydration mismatch on refresh. Instead, style the outer primitive directly with the inner's CVA classes — `<DialogTrigger className={cn(buttonVariants({ variant, size }))}>` — so there is exactly one `useRender` chain on the rendered element. Same rule applies to `Popover.Trigger`, `Menu.Trigger`, etc.

**React Compiler** — enabled in `next.config.ts`. Avoid manual `useMemo`/`useCallback` unless you have a specific reason.

**MCP servers** configured in `.mcp.json`: `next-devtools` and `shadcn` CLI.


<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
