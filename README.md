# voz.gg

A game server portal for the voz.gg community. Members link their game accounts
and access connection details and live status for community-run game servers.
Admins can manage whitelists, monitor activity, and view historical server stats.

## Features

### For Members

- Link game accounts: Steam, Minecraft, Hytale, and more
- View game server connection details (IP, port, version)
- See live server status and current player count

### For Admins

- View all linked accounts for a given game
- Generate whitelist files per game/server
- See who is currently online on each server
- View historical stats: player counts over time, last-seen per user
- Browse all users who have ever logged into a server, sorted by last seen

## Tech Stack

- [Next.js 16](https://nextjs.org) App Router, React 19
- [Tailwind CSS 4](https://tailwindcss.com)
- [shadcn/ui](https://ui.shadcn.com) (base-vega style)
- TypeScript

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── app/          # App Router pages and layouts
├── components/   # Shared components
│   └── ui/       # shadcn/ui components
└── lib/          # Utilities (cn, etc.)
```

## Roadmap

- [ ] Authentication
- [ ] User profile page with game account linking
- [ ] Game server integration (status polling, player lists)
- [ ] Admin dashboard
