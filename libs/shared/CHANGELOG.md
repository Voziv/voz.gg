## 0.12.0 (2026-06-27)

### 🚀 Features

- **shared:** add Server row type export ([3653c99](https://github.com/Voziv/voz.gg/commit/3653c99))

### ❤️ Thank You

- Voz @Voziv

## 0.11.0 (2026-06-24)

### 🚀 Features

- **shared:** add update detect-and-notify orchestrator ([e743634](https://github.com/Voziv/voz.gg/commit/e743634))
- **shared:** add update detection dao and exports ([6f651da](https://github.com/Voziv/voz.gg/commit/6f651da))
- **shared:** add update discord message formatter ([00e8c5f](https://github.com/Voziv/voz.gg/commit/00e8c5f))
- **shared:** add update detection orchestration ([dc547cb](https://github.com/Voziv/voz.gg/commit/dc547cb))
- **shared:** add update resolver registry ([ab363b6](https://github.com/Voziv/voz.gg/commit/ab363b6))
- **shared:** add curseforge version resolver ([097b0bb](https://github.com/Voziv/voz.gg/commit/097b0bb))
- **shared:** add packwiz version resolver ([9d38b95](https://github.com/Voziv/voz.gg/commit/9d38b95))
- **shared:** add ftb version resolver ([6273c15](https://github.com/Voziv/voz.gg/commit/6273c15))
- **shared:** add modrinth version resolver ([ca44790](https://github.com/Voziv/voz.gg/commit/ca44790))
- **shared:** add fabric version resolver ([ff0213c](https://github.com/Voziv/voz.gg/commit/ff0213c))
- **shared:** add neoforge version resolver ([1a9a2ec](https://github.com/Voziv/voz.gg/commit/1a9a2ec))
- **shared:** add forge version resolver ([a5e71a8](https://github.com/Voziv/voz.gg/commit/a5e71a8))
- **shared:** add vanilla version resolver ([3441667](https://github.com/Voziv/voz.gg/commit/3441667))
- **shared:** add update notify decision logic ([b7eb948](https://github.com/Voziv/voz.gg/commit/b7eb948))
- **shared:** add update-tracking schema and state table ([656366e](https://github.com/Voziv/voz.gg/commit/656366e))

### 🩹 Fixes

- **shared:** add loader version line so forge and neoforge resolve ([27da1c2](https://github.com/Voziv/voz.gg/commit/27da1c2))
- **shared:** import vitest symbols in update test files for tsc build ([535a63f](https://github.com/Voziv/voz.gg/commit/535a63f))
- **shared:** key update detection groups by host and cover intra-host isolation ([4af454e](https://github.com/Voziv/voz.gg/commit/4af454e))

### ❤️ Thank You

- Voz @Voziv

## 0.10.0 (2026-06-22)

### 🚀 Features

- **shared:** add server-control columns to servers ([184097c](https://github.com/Voziv/voz.gg/commit/184097c))

### ❤️ Thank You

- Voz @Voziv

## 0.9.0 (2026-06-21)

### 🚀 Features

- **web:** add per-player muted toggle ([a235b01](https://github.com/Voziv/voz.gg/commit/a235b01))
- **shared:** add drizzle notification dao and exports ([0cf8544](https://github.com/Voziv/voz.gg/commit/0cf8544))
- **shared:** add notification queue-message orchestrator ([e497281](https://github.com/Voziv/voz.gg/commit/e497281))
- **shared:** return notable events from presence batch ([96340fd](https://github.com/Voziv/voz.gg/commit/96340fd))
- **shared:** add pure notification decision logic ([c3be1bf](https://github.com/Voziv/voz.gg/commit/c3be1bf))
- **shared:** add muted, webhook url, notification_log schema ([e7f6100](https://github.com/Voziv/voz.gg/commit/e7f6100))

### 🩹 Fixes

- **shared:** retry Discord 429 and guard audit-write failures ([01169c1](https://github.com/Voziv/voz.gg/commit/01169c1))
- **events-ingest:** chunk and guard notification enqueue ([673e8d4](https://github.com/Voziv/voz.gg/commit/673e8d4))
- **shared:** drop unused import, widen cooldown tests ([b5f611c](https://github.com/Voziv/voz.gg/commit/b5f611c))

### ❤️ Thank You

- Voz @Voziv

## 0.8.0 (2026-06-15)

### 🚀 Features

- **shared:** add Drizzle player mutations DAO and exports ([a30082f](https://github.com/Voziv/voz.gg/commit/a30082f))
- **shared:** add player mutation DAO interface and handlers ([cec722b](https://github.com/Voziv/voz.gg/commit/cec722b))
- **shared:** add player mutation validators and merge combine logic ([286f2a4](https://github.com/Voziv/voz.gg/commit/286f2a4))

### ❤️ Thank You

- Voz @Voziv

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