## 0.2.1 (2026-05-31)

### 🩹 Fixes

- **web:** brighten status colors in dark mode for contrast ([7f0d55e](https://github.com/Voziv/voz.gg/commit/7f0d55e))

### ❤️ Thank You

- Voz @Voziv

## 0.2.0 (2026-05-31)

### 🚀 Features

- **web:** type custom auth fields via inferAdditionalFields ([4c7dc4e](https://github.com/Voziv/voz.gg/commit/4c7dc4e))

### ❤️ Thank You

- Voz @Voziv

## 0.1.0 (2026-05-31)

### 🚀 Features

- **web:** recolor dashboard components to theme tokens ([7f09af0](https://github.com/Voziv/voz.gg/commit/7f09af0))
- **web:** recolor app chrome to tokens and mount theme toggle ([4cdd515](https://github.com/Voziv/voz.gg/commit/4cdd515))
- **web:** sync toaster theme with active theme ([8dca887](https://github.com/Voziv/voz.gg/commit/8dca887))
- **web:** add theme toggle island ([c8b5b11](https://github.com/Voziv/voz.gg/commit/c8b5b11))
- **web:** apply theme before paint via inline head script ([63eae2e](https://github.com/Voziv/voz.gg/commit/63eae2e))
- **web:** adopt leerobert palette via two-layer theme tokens ([e937aa8](https://github.com/Voziv/voz.gg/commit/e937aa8))
- **web:** add theme persistence and apply helpers ([255f961](https://github.com/Voziv/voz.gg/commit/255f961))
- **web:** add theme resolution helpers ([2544b38](https://github.com/Voziv/voz.gg/commit/2544b38))
- **shared:** add theme preference column to user ([6433c66](https://github.com/Voziv/voz.gg/commit/6433c66))
- **web:** add admin create/edit/delete controls to servers page ([7d63e8c](https://github.com/Voziv/voz.gg/commit/7d63e8c))
- **web:** add delete-server button island ([108c03a](https://github.com/Voziv/voz.gg/commit/108c03a))
- **web:** add server create/edit dialog island ([d9b71e5](https://github.com/Voziv/voz.gg/commit/d9b71e5))
- **web:** port base-vega dialog primitive (fix render-prop hydration gotcha) ([14b20d4](https://github.com/Voziv/voz.gg/commit/14b20d4))
- **web:** add update/delete-server api route (admin) ([6d22495](https://github.com/Voziv/voz.gg/commit/6d22495))
- **web:** add create-server api route (admin) ([1c5e878](https://github.com/Voziv/voz.gg/commit/1c5e878))
- **web:** add isAdmin role guard (tdd) ([4717f5a](https://github.com/Voziv/voz.gg/commit/4717f5a))
- **web:** add zod server schema and parse helper (tdd) ([844a025](https://github.com/Voziv/voz.gg/commit/844a025))
- **web:** add zod and nanoid deps ([6fc9c89](https://github.com/Voziv/voz.gg/commit/6fc9c89))
- **web:** reject linking a minecraft account already claimed by another user ([68e22f8](https://github.com/Voziv/voz.gg/commit/68e22f8))
- **shared:** make minecraft_uuid unique ([e2d9926](https://github.com/Voziv/voz.gg/commit/e2d9926))
- **web:** add dashboard index/profile/servers pages ([f7224ba](https://github.com/Voziv/voz.gg/commit/f7224ba))
- **web:** add dashboard shell layout and placeholder status badge ([9b9b3b7](https://github.com/Voziv/voz.gg/commit/9b9b3b7))
- **web:** add profile islands (name/bio, minecraft, steam, sign-out) ([ac2cec9](https://github.com/Voziv/voz.gg/commit/ac2cec9))
- **web:** add steam unlink api route ([8c45583](https://github.com/Voziv/voz.gg/commit/8c45583))
- **web:** add minecraft lookup/link/unlink api route ([a6aeeec](https://github.com/Voziv/voz.gg/commit/a6aeeec))
- **web:** generate d1 migration for servers table ([f0bb000](https://github.com/Voziv/voz.gg/commit/f0bb000))
- **web:** port mojang profile lookup (tdd) ([79c59bd](https://github.com/Voziv/voz.gg/commit/79c59bd))
- **web:** port base-vega shadcn primitives (button/card/input/label/badge/sonner) ([498674e](https://github.com/Voziv/voz.gg/commit/498674e))
- **web:** add base-ui/shadcn deps, cn util, and tw-animate-css ([9ef0dbb](https://github.com/Voziv/voz.gg/commit/9ef0dbb))
- **web:** add steam openid account-linking routes ([0b41a6d](https://github.com/Voziv/voz.gg/commit/0b41a6d))
- **web:** add sign-in page and react island; enable landing sign-in ([04ebb25](https://github.com/Voziv/voz.gg/commit/04ebb25))
- **web:** add auth handler mount, session middleware, and dashboard placeholder ([b538fae](https://github.com/Voziv/voz.gg/commit/b538fae))
- **web:** add astro react integration and better-auth client ([4cca2bb](https://github.com/Voziv/voz.gg/commit/4cca2bb))
- **web:** add better-auth instance factory and locals types ([23d99a2](https://github.com/Voziv/voz.gg/commit/23d99a2))
- **web:** add transactional email helper for magic links ([f79d8ac](https://github.com/Voziv/voz.gg/commit/f79d8ac))
- **web:** declare auth env vars and regenerate worker types ([62d0c7e](https://github.com/Voziv/voz.gg/commit/62d0c7e))
- **web:** add public-path classifier for auth middleware (tdd) ([5df28d9](https://github.com/Voziv/voz.gg/commit/5df28d9))
- **web:** port steam web api summary fetch (tdd) ([a998e77](https://github.com/Voziv/voz.gg/commit/a998e77))
- **web:** port steam openid verification (tdd) ([94cd8a9](https://github.com/Voziv/voz.gg/commit/94cd8a9))
- **web:** generate d1 migration for better-auth schema ([9d04760](https://github.com/Voziv/voz.gg/commit/9d04760))
- **web:** port landing page and styling foundation ([09fd02b](https://github.com/Voziv/voz.gg/commit/09fd02b))
- **web:** wire d1 database with drizzle migrations ([772dae2](https://github.com/Voziv/voz.gg/commit/772dae2))
- **web:** add /api/health endpoint querying d1 ([ed7f7cd](https://github.com/Voziv/voz.gg/commit/ed7f7cd))
- **web:** scaffold astro ssr app on cloudflare adapter ([53e1433](https://github.com/Voziv/voz.gg/commit/53e1433))

### 🩹 Fixes

- **web:** tokenize status colors for light-mode legibility ([0b50d3a](https://github.com/Voziv/voz.gg/commit/0b50d3a))
- **web:** set base text color on outline button variant ([de2940b](https://github.com/Voziv/voz.gg/commit/de2940b))
- **web:** guard pending state and drop non-null assertions in server CRUD ([6c58d47](https://github.com/Voziv/voz.gg/commit/6c58d47))
- **web:** reject host values containing a port (colon) ([8e9cecb](https://github.com/Voziv/voz.gg/commit/8e9cecb))
- **web:** forward steam banner query, harden mojang fetch, fix unlink button state ([0196a2e](https://github.com/Voziv/voz.gg/commit/0196a2e))
- **web:** handle steam link conflict and correct config comment ([c9ac90a](https://github.com/Voziv/voz.gg/commit/c9ac90a))

### 🧱 Updated Dependencies

- Updated shared to 0.1.0

### ❤️ Thank You

- Voz @Voziv