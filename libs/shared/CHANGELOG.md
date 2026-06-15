## 0.7.0 (2026-06-15)

### 🚀 Features

- **shared:** add player detail read-time assembly ([31fc622](https://github.com/Voziv/voz.gg/commit/31fc622))
- **shared:** enrich players overview with status, groups, server scope ([2ce6828](https://github.com/Voziv/voz.gg/commit/2ce6828))
- **shared:** carry join IP onto derived sessions ([543eddd](https://github.com/Voziv/voz.gg/commit/543eddd))
- **shared:** add player status, isBot, and group tag tables ([fe47339](https://github.com/Voziv/voz.gg/commit/fe47339))

### ❤️ Thank You

- Voz @Voziv

## 0.6.0 (2026-06-14)

### 🚀 Features

- **shared:** add agent-host columns and game-type defaults to servers ([53f2749](https://github.com/Voziv/voz.gg/commit/53f2749))

### ❤️ Thank You

- Voz @Voziv

## 0.5.0 (2026-06-14)

### 🚀 Features

- **shared:** validate presence events per-item, skip and count invalid ([4338ebe](https://github.com/Voziv/voz.gg/commit/4338ebe))
- **web:** add admin players overview at /dashboard/players ([4818015](https://github.com/Voziv/voz.gg/commit/4818015))
- **shared:** add Drizzle presence DAO and agent-token server resolver ([6314419](https://github.com/Voziv/voz.gg/commit/6314419))
- **shared:** add idempotent presence batch ingest logic ([a6234a2](https://github.com/Voziv/voz.gg/commit/a6234a2))
- **shared:** derive sessions and playtime from presence events ([2070ea7](https://github.com/Voziv/voz.gg/commit/2070ea7))
- **shared:** add presence_events, player, player_identity tables ([95c2788](https://github.com/Voziv/voz.gg/commit/95c2788))

### 🩹 Fixes

- **shared:** harden bearerToken regex against ReDoS on auth header ([c6bd804](https://github.com/Voziv/voz.gg/commit/c6bd804))
- **shared:** tolerate concurrent identity insert race in presence DAO ([b51b104](https://github.com/Voziv/voz.gg/commit/b51b104))
- **shared:** set player.user_id FK to ON DELETE SET NULL ([7674a75](https://github.com/Voziv/voz.gg/commit/7674a75))

### ❤️ Thank You

- Voz @Voziv

## 0.4.1 (2026-06-14)

This was a version bump only for shared to align it with other projects, there were no code changes.

## 0.4.0 (2026-06-02)

### 🚀 Features

- **shared:** add admin_audit_log table ([bc680be](https://github.com/Voziv/voz.gg/commit/bc680be))

### ❤️ Thank You

- Voz @Voziv

## 0.3.0 (2026-06-02)

### 🚀 Features

- **shared:** add invite_request table ([822b156](https://github.com/Voziv/voz.gg/commit/822b156))

### ❤️ Thank You

- Voz @Voziv

## 0.2.1 (2026-05-31)

This was a version bump only for shared to align it with other projects, there were no code changes.

## 0.2.0 (2026-05-31)

### 🚀 Features

- **shared:** add server_status and server_agent tables ([957f8f0](https://github.com/Voziv/voz.gg/commit/957f8f0))

### ❤️ Thank You

- Voz @Voziv

## 0.1.0 (2026-05-31)

### 🚀 Features

- **shared:** add theme preference column to user ([6433c66](https://github.com/Voziv/voz.gg/commit/6433c66))
- **shared:** make minecraft_uuid unique ([e2d9926](https://github.com/Voziv/voz.gg/commit/e2d9926))
- **shared:** add servers table and GameType ([113b47e](https://github.com/Voziv/voz.gg/commit/113b47e))
- **shared:** add better-auth drizzle schema (user/session/account/verification) ([2911049](https://github.com/Voziv/voz.gg/commit/2911049))
- **shared:** add d1 drizzle schema, client, and shared types ([e88e328](https://github.com/Voziv/voz.gg/commit/e88e328))

### ❤️ Thank You

- Voz @Voziv