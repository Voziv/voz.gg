## 0.10.0 (2026-06-03)

### 🚀 Features

- **web:** add read-only audit log page and nav ([8a96e7f](https://github.com/Voziv/voz.gg/commit/8a96e7f))

### ❤️ Thank You

- Voz @Voziv

## 0.9.0 (2026-06-03)

### 🚀 Features

- **web:** add user administration page and nav ([33f7f1a](https://github.com/Voziv/voz.gg/commit/33f7f1a))
- **web:** add users admin table island ([d850a30](https://github.com/Voziv/voz.gg/commit/d850a30))

### 🩹 Fixes

- **web:** unify row pending state and drop unused banExpires ([4d5d959](https://github.com/Voziv/voz.gg/commit/4d5d959))

### ❤️ Thank You

- Voz @Voziv

## 0.8.0 (2026-06-03)

### 🚀 Features

- **web:** add ownership transfer route ([b8c7700](https://github.com/Voziv/voz.gg/commit/b8c7700))
- **web:** add transferOwnership to user dao ([f422b9d](https://github.com/Voziv/voz.gg/commit/f422b9d))

### ❤️ Thank You

- Voz @Voziv

## 0.7.0 (2026-06-03)

### 🚀 Features

- **web:** add set-role user-admin route ([b3d1d66](https://github.com/Voziv/voz.gg/commit/b3d1d66))
- **web:** add delete and revoke-sessions user-admin routes ([78dfcd3](https://github.com/Voziv/voz.gg/commit/78dfcd3))
- **web:** add ban/unban user-admin routes ([9771754](https://github.com/Voziv/voz.gg/commit/9771754))
- **web:** add shared user-admin route helper ([e337399](https://github.com/Voziv/voz.gg/commit/e337399))
- **web:** add user dao with byId lookup ([49553c2](https://github.com/Voziv/voz.gg/commit/49553c2))

### ❤️ Thank You

- Voz @Voziv

## 0.6.0 (2026-06-02)

### 🚀 Features

- **web:** add admin audit dao ([b1be6f1](https://github.com/Voziv/voz.gg/commit/b1be6f1))
- **web:** migrate admin_audit_log table ([3aa3e7f](https://github.com/Voziv/voz.gg/commit/3aa3e7f))

### 🧱 Updated Dependencies

- Updated shared to 0.4.0

### ❤️ Thank You

- Voz @Voziv

## 0.5.0 (2026-06-02)

### 🚀 Features

- **web:** gate admin nav with isAdmin so owner sees it ([39b5bd7](https://github.com/Voziv/voz.gg/commit/39b5bd7))
- **web:** register owner/admin/user roles with better-auth ([8404222](https://github.com/Voziv/voz.gg/commit/8404222))
- **web:** treat owner as admin and add isOwner ([1775382](https://github.com/Voziv/voz.gg/commit/1775382))
- **web:** add user-admin authorization guards ([92fae1e](https://github.com/Voziv/voz.gg/commit/92fae1e))
- **web:** add access-control roles and permissions module ([d879a10](https://github.com/Voziv/voz.gg/commit/d879a10))

### ❤️ Thank You

- Voz @Voziv

## 0.4.1 (2026-06-02)

### 🩹 Fixes

- **web:** keep Google sign-in button opaque on hover ([033f4d4](https://github.com/Voziv/voz.gg/commit/033f4d4))

### ❤️ Thank You

- Voz @Voziv

## 0.4.0 (2026-06-02)

### 🚀 Features

- **web:** add request-invite CTA to landing page ([dd0ea30](https://github.com/Voziv/voz.gg/commit/dd0ea30))
- **web:** add admin invite-requests review UI ([4f9ca40](https://github.com/Voziv/voz.gg/commit/4f9ca40))
- **web:** add Turnstile and invite messaging to sign-in ([e69073b](https://github.com/Voziv/voz.gg/commit/e69073b))
- **web:** add invite-request form and page ([dd48ad2](https://github.com/Voziv/voz.gg/commit/dd48ad2))
- **web:** add Turnstile widget island ([86fb75c](https://github.com/Voziv/voz.gg/commit/86fb75c))
- **web:** add admin approve/deny invite endpoints ([dc96e7c](https://github.com/Voziv/voz.gg/commit/dc96e7c))
- **web:** add public invite-request submission endpoint ([af2393a](https://github.com/Voziv/voz.gg/commit/af2393a))
- **web:** make invite-request routes public ([b5375e3](https://github.com/Voziv/voz.gg/commit/b5375e3))
- **web:** gate account creation to approved invites ([f30d497](https://github.com/Voziv/voz.gg/commit/f30d497))
- **web:** add invite-request data-access layer ([5b5792c](https://github.com/Voziv/voz.gg/commit/5b5792c))
- **web:** source mail FROM from env and add HTML templates ([03f4256](https://github.com/Voziv/voz.gg/commit/03f4256))
- **web:** add Turnstile site-key resolver ([92daf1c](https://github.com/Voziv/voz.gg/commit/92daf1c))
- **web:** add Turnstile server-side verification ([54cbfc4](https://github.com/Voziv/voz.gg/commit/54cbfc4))
- **web:** add invite status-transition guards ([18cc66c](https://github.com/Voziv/voz.gg/commit/18cc66c))
- **web:** add invite-request input validation ([99f6f57](https://github.com/Voziv/voz.gg/commit/99f6f57))
- **shared:** add invite_request table ([822b156](https://github.com/Voziv/voz.gg/commit/822b156))

### 🩹 Fixes

- **web:** follow page theme in Turnstile and fix light-mode social buttons ([4383ad6](https://github.com/Voziv/voz.gg/commit/4383ad6))
- **web:** surface magic-link errors on sign-in ([8b3995d](https://github.com/Voziv/voz.gg/commit/8b3995d))

### 🧱 Updated Dependencies

- Updated shared to 0.3.0

### ❤️ Thank You

- Voz @Voziv

## 0.3.2 (2026-06-01)

### 🩹 Fixes

- **web:** skip auth on prerendered routes ([7bc76a6](https://github.com/Voziv/voz.gg/commit/7bc76a6))

### ❤️ Thank You

- Voz @Voziv

## 0.3.1 (2026-05-31)

### 🧱 Updated Dependencies

- Updated shared to 0.2.1

## 0.3.0 (2026-05-31)

### 🚀 Features

- **web:** add status-monitor agent install script ([d045223](https://github.com/Voziv/voz.gg/commit/d045223))
- **web:** join server status on the servers page and surface install command ([e3c0377](https://github.com/Voziv/voz.gg/commit/e3c0377))
- **web:** add real StatusBadge and staleness display logic ([e60e80c](https://github.com/Voziv/voz.gg/commit/e60e80c))
- **web:** mint enrollment token on server create and add regenerate route ([742c5c2](https://github.com/Voziv/voz.gg/commit/742c5c2))
- **web:** add agent enroll/config/status endpoints ([2bd238e](https://github.com/Voziv/voz.gg/commit/2bd238e))
- **web:** add pure agent enroll/config/status handlers ([58d5ce4](https://github.com/Voziv/voz.gg/commit/58d5ce4))
- **web:** add agent data-access layer ([36b4a9d](https://github.com/Voziv/voz.gg/commit/36b4a9d))
- **web:** add agent token hashing and resolution ([4e69f6d](https://github.com/Voziv/voz.gg/commit/4e69f6d))
- **web:** add agent config builder and opaque config hash ([c0b7bb3](https://github.com/Voziv/voz.gg/commit/c0b7bb3))
- **shared:** add server_status and server_agent tables ([957f8f0](https://github.com/Voziv/voz.gg/commit/957f8f0))

### 🩹 Fixes

- **web:** use theme success/destructive/muted tokens in status badge and agent install dialog ([525e3a9](https://github.com/Voziv/voz.gg/commit/525e3a9))

### 🧱 Updated Dependencies

- Updated shared to 0.2.0

### ❤️ Thank You

- Voz @Voziv

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