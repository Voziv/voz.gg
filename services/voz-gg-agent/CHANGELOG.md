## 0.6.0 (2026-06-15)

### 🚀 Features

- **voz-gg-agent:** install logparse unit during setup when enabled ([fd2daf9](https://github.com/Voziv/voz.gg/commit/fd2daf9))
- **voz-gg-agent:** render hardened logparse systemd unit ([472c80a](https://github.com/Voziv/voz.gg/commit/472c80a))
- **voz-gg-agent:** resolve logparse log directory interactively ([a8547d8](https://github.com/Voziv/voz.gg/commit/a8547d8))
- **voz-gg-agent:** add pathExists and non-interactive setup flag ([50eb0f8](https://github.com/Voziv/voz.gg/commit/50eb0f8))
- **voz-gg-agent:** decode logParser provisioning capability ([c79526b](https://github.com/Voziv/voz.gg/commit/c79526b))

### ❤️ Thank You

- Voz @Voziv

## 0.5.0 (2026-06-14)

### 🚀 Features

- **voz-gg-agent:** implement logparse subcommand ([be92f8d](https://github.com/Voziv/voz.gg/commit/be92f8d))
- **voz-gg-agent:** orchestrate backfill, batching, checkpoint ([81e60e6](https://github.com/Voziv/voz.gg/commit/81e60e6))
- **voz-gg-agent:** deliver presence batches with retry ([bde0b0a](https://github.com/Voziv/voz.gg/commit/bde0b0a))
- **voz-gg-agent:** read rolled and latest minecraft logs ([9d355e3](https://github.com/Voziv/voz.gg/commit/9d355e3))
- **voz-gg-agent:** persist logparse read checkpoint ([c00f915](https://github.com/Voziv/voz.gg/commit/c00f915))
- **voz-gg-agent:** split log line prefix from message body ([f11a4a4](https://github.com/Voziv/voz.gg/commit/f11a4a4))
- **voz-gg-agent:** resolve log timestamps with midnight wrap ([a569f30](https://github.com/Voziv/voz.gg/commit/a569f30))
- **voz-gg-agent:** parse minecraft log lines to presence events ([7dfafc9](https://github.com/Voziv/voz.gg/commit/7dfafc9))

### 🩹 Fixes

- **voz-gg-agent:** match status code precisely in isPermanent ([cb0bf3a](https://github.com/Voziv/voz.gg/commit/cb0bf3a))
- **voz-gg-agent:** reset logparse offset on rotation, cap batch size ([9930403](https://github.com/Voziv/voz.gg/commit/9930403))

### 🧱 Updated Dependencies

- Updated go-shared to 0.3.0

### ❤️ Thank You

- Voz @Voziv

## 0.4.0 (2026-06-14)

### 🚀 Features

- **voz-gg-agent:** wire setup subcommand with real host operations ([ee0d3ba](https://github.com/Voziv/voz.gg/commit/ee0d3ba))
- **voz-gg-agent:** add setup provisioning orchestrator ([cd2fca4](https://github.com/Voziv/voz.gg/commit/cd2fca4))

### ❤️ Thank You

- Voz @Voziv

## 0.3.0 (2026-06-14)

### 🚀 Features

- **voz-gg-agent:** add subcommand dispatch (monitor, logparse, write-config) ([a702be3](https://github.com/Voziv/voz.gg/commit/a702be3))

### ❤️ Thank You

- Voz @Voziv

## 0.2.3 (2026-06-14)

### 🧱 Updated Dependencies

- Updated go-shared to 0.2.3

## 0.2.2 (2026-06-14)

### 🧱 Updated Dependencies

- Updated go-shared to 0.2.2

## 0.2.1 (2026-05-31)

### 🧱 Updated Dependencies

- Updated go-shared to 0.2.1

## 0.2.0 (2026-05-31)

### 🚀 Features

- **status-monitor:** wire flags, config load, and poll loop ([09a7ddd](https://github.com/Voziv/voz.gg/commit/09a7ddd))
- **status-monitor:** add probe-report-reconcile cycle ([f17c0ae](https://github.com/Voziv/voz.gg/commit/f17c0ae))
- **status-monitor:** add prober registry ([59ed60a](https://github.com/Voziv/voz.gg/commit/59ed60a))
- **status-monitor:** add Source A2S prober ([7988bf2](https://github.com/Voziv/voz.gg/commit/7988bf2))
- **status-monitor:** add Minecraft SLP prober ([8bdaeb2](https://github.com/Voziv/voz.gg/commit/8bdaeb2))
- **status-monitor:** add prober types and TCP fallback prober ([d5d2871](https://github.com/Voziv/voz.gg/commit/d5d2871))
- **status-monitor:** add config load/save and enroll bootstrap ([dc1c939](https://github.com/Voziv/voz.gg/commit/dc1c939))

### 🩹 Fixes

- **status-monitor:** cap SLP packet size and drop dead pullConfig param ([3146130](https://github.com/Voziv/voz.gg/commit/3146130))

### 🧱 Updated Dependencies

- Updated go-shared to 0.2.0

### ❤️ Thank You

- Voz @Voziv

## 0.1.0 (2026-05-31)

### 🚀 Features

- **status-monitor:** add VERSION file and --version flag ([b64d9fd](https://github.com/Voziv/voz.gg/commit/b64d9fd))
- **status-monitor:** add go daemon stub importing go-shared ([7eb4306](https://github.com/Voziv/voz.gg/commit/7eb4306))

### 🧱 Updated Dependencies

- Updated go-shared to 0.1.0

### ❤️ Thank You

- Voz @Voziv