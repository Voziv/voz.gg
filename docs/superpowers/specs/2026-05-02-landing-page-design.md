---
date: 2026-05-02
feature: Landing Page & README
status: implemented
---

# voz.gg — Landing Page & README Design

## Context

Initial public-facing shell for voz.gg, a game server portal. Users link game
accounts (Steam, Minecraft, Hytale) and view server connection details and status.
Admins manage whitelists, view stats, and track user activity.

This spec covers the README and the pre-auth landing page.

## Landing Page

**Layout:** Full-viewport split — left/right halves on desktop, left only on mobile.

**Left panel:** Vertically centered — `voz.gg` wordmark (8xl bold, cyan glow),
tagline "Your servers. Your community." (muted), disabled Sign In button.

**Right panel:** CSS-animated SVG — 5×8 dot grid pulsing staggered with `dot-pulse`
keyframe, 3 server rack bars with green status dots. Background `#0d0d14`,
border-left `#1a1a2e`.

**Colors:** Background `#0a0a0f`, accent cyan `#00e5ff`, status green `#00ff88`.

**Responsive:** Right panel `hidden md:flex`. Left panel fills full width on mobile.

## README

Sections: project overview, Features (Members + Admins), Tech Stack,
Getting Started, Project Structure, Roadmap.
