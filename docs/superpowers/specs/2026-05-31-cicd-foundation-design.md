---
date: 2026-05-31
feature: CI/CD foundation (PR checks, conventional-commit enforcement, nx release, Cloudflare deploy)
status: designed
sub_project: CI/CD foundation (cross-cutting; added 2026-05-31, parallel with #6)
---

# voz.gg — CI/CD foundation

## Context

A cross-cutting DevOps sub-project for the `voz.gg` nx polyglot monorepo
(Astro/Workers TS + Go services/tools). It delivers GitHub Actions for:
PR checks, conventional-commit enforcement, automated per-project releases, and
Cloudflare deploys from `main`. It is **independent of the feature sub-projects**
and is being specced/built in parallel with #6 (live server status). #6 consumes
one output of this project — a published GitHub Release containing the
cross-compiled `status-monitor` binary.

Current state: there is **no `.github/`**, no commitlint/husky, and no `nx release`
config. Deploys are run by hand (`nx deploy web` / `nx deploy events-ingest`).
The repo already uses **conventional commits** (per the global contributor
guide) and is being made public, so anonymous GitHub Releases are viable.

Projects (nx) and their release scopes: `web` (apps), `events-ingest` +
`status-monitor` (services), `mc-logparser` (tools), `shared` + `go-shared`
(libs). Single root `go.mod` (module `voz.gg`).

## Decisions

- **Releases via `nx release`, not the `semantic-release` package.** `nx release`
  is monorepo-native and polyglot-aware; raw `semantic-release` is single-package
  and npm-centric (our Go projects have no `package.json`). It reads conventional
  commits, bumps versions, writes per-project changelogs, and creates git tags +
  GitHub releases.
- **Independent (per-project) versioning** (`projectsRelationship: "independent"`).
  Each project versions and releases on its own (tag pattern
  `{projectName}@{version}`). A `status-monitor` patch never re-releases `web`.
- **Go version source = a per-project `VERSION` file**, embedded into the binary
  at build via `-ldflags "-X main.version=<v>"` and surfaced by a `--version`
  flag. TS projects use their `package.json` version. (Go projects have no
  `package.json` for `nx release` to bump.)
- **Conventional commits enforced** at two layers: a local `commit-msg` hook
  (husky + commitlint) and a **CI job that lints every commit in the PR range**
  (not just the PR title), because merges are **rebase + fast-forward** (every
  commit lands on `main` individually).
- **Merge method: rebase + fast-forward** (a GitHub repo setting the maintainer
  enables; squash/merge-commit disabled). Retaining individual commits keeps
  per-project release attribution accurate when a PR touches multiple projects —
  `nx release` attributes each commit to the project(s) whose files it changed,
  so granular commits → granular bumps. (A squashed multi-project commit would
  bump every touched project at once.)
- **AI-agent + human docs** in `AGENTS.md`: a short "Commits & PRs" section
  stating the convention, the enforcement, the valid scopes, and the merge model.
- **Cloudflare auth via API token** (`CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ACCOUNT_ID` secrets) — the supported path for `wrangler deploy`;
  CF's OIDC story for Wrangler is immature.
- **Binary targets:** `linux/amd64`, `linux/arm64`, `darwin/arm64`.
- **Caching, no nx Cloud:** `actions/cache` for the pnpm store, nx cache, and Go
  build/module cache.

## Goals

- Every PR runs `nx affected` lint/test/build and rejects non-conventional
  commits, before merge.
- Merging to `main` auto-deploys changed Workers to Cloudflare.
- Merging to `main` auto-releases changed projects (version bump, changelog, tag,
  GitHub release), and publishes the `status-monitor` binaries to its release.
- Contributors (incl. AI agents) have a clear, discoverable commit/PR convention.

## Non-goals (out of scope)

- The agent itself, probers, enrollment (those are #6); this only **publishes**
  the `status-monitor` binary release that #6's install script consumes.
- npm publishing of `shared`/`go-shared` (internal libs; versioned + changelogged
  but not published to a registry).
- Preview/staging environments, e2e infrastructure, container builds.
- Branch-protection *rules* themselves are configured in the GitHub UI by the
  maintainer (this spec documents the required checks + the release-push token,
  but does not script org settings).

## Architecture & components

### A. Tooling / dependencies (root)

Dev deps (pnpm, root): `@commitlint/cli`, `@commitlint/config-conventional`,
`husky`. `nx release` ships with the already-installed `nx`.

### B. Conventional-commit enforcement

- **`commitlint.config.js`** (root): extends `@commitlint/config-conventional`.
  Types allowed: `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`.
  **Scope is advisory** (recommended = a project name; documented, not enforced as
  an enum) since `nx release` attributes bumps by changed files, not the scope
  string. `subject` rules per the conventional default (imperative, no trailing
  period, sensible length).
- **husky `commit-msg` hook** (`.husky/commit-msg`): runs
  `pnpm exec commitlint --edit "$1"` so bad messages are rejected at author time.
  `prepare` script runs `husky` to install hooks on `pnpm install`.
- **CI commit-range lint** (in `ci.yml`, PRs): `pnpm exec commitlint --from
  "${{ github.event.pull_request.base.sha }}" --to "${{ github.event.pull_request.head.sha }}" --verbose`
  — validates **every** commit in the PR (the enforcement that survives a bypassed
  local hook, and the right check given rebase+ff merges). No separate PR-title
  lint (titles are not used as commit messages under rebase+ff; add one only if
  squash merging is ever enabled).
- **`AGENTS.md`** gains a concise **"Commits & PRs"** section: the
  `<type>(<scope>): <subject>` format, the allowed types, the recommended scopes
  (`web`, `events-ingest`, `status-monitor`, `mc-logparser`, `shared`,
  `go-shared`; omit scope for repo-wide changes), that commits are linted locally
  + in CI, that **every commit must comply** (rebase+ff), and that the scope/commit
  granularity drives independent versioning.

### C. `nx release` configuration — `nx.json`

```jsonc
"release": {
  "projectsRelationship": "independent",
  "releaseTagPattern": "{projectName}@{version}",
  "version": {
    "conventionalCommits": true
  },
  "changelog": {
    "projectChangelogs": true,            // per-project CHANGELOG.md
    "workspaceChangelog": false
  },
  "git": { "commit": true, "tag": true }
}
```

- Bumps are computed from conventional commits since each project's last
  `{projectName}@{version}` tag, scoped by the project graph (files changed).
- TS projects: version lives in their `package.json` (nx bumps it).
- Go projects: see (D) — version lives in a `VERSION` file; a custom
  `versionActions`/post-version step keeps it in sync.

### D. Go project versioning (`VERSION` file + ldflags)

- Each releasable Go project (`status-monitor`, and later `mc-logparser`) gets a
  **`VERSION`** file at its root (e.g. `services/status-monitor/VERSION` → `0.1.0`).
- `nx release` updates that file for Go projects (via a custom version actor or a
  small post-version script that writes the computed version into `VERSION`), and
  tags `status-monitor@<version>`.
- The Go `build`/release compile passes
  `-ldflags "-X main.version=$(cat VERSION)"`; `main` exposes a `--version` flag
  that prints it. This makes the deployed agent self-identifying and gives the
  release workflow the version to name assets.

### E. Workflows — `.github/workflows/`

All set up Node + pnpm (+ Go where needed) and restore `actions/cache` for the
pnpm store, nx cache, and Go caches.

1. **`ci.yml`** — on `pull_request` (and `push` to non-main branches):
   - `nx affected -t lint,test,build --base=<PR base> --head=<PR head>` (Node +
     Go toolchains; nx-go runs Go lint/test/build).
   - the commit-range commitlint step (B).
   These are the **required status checks** for branch protection.

2. **`deploy.yml`** — on `push` to `main`:
   - `nx affected -t deploy --base=<before> --head=<sha>` for `web` +
     `events-ingest` (deploys only changed Workers; no-op when neither changed).
   - Auth: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

3. **`release.yml`** — on `push` to `main` (after merge):
   - `nx release --yes` → computes per-project bumps from conventional commits,
     updates versions (`package.json` / `VERSION`), writes per-project changelogs,
     commits, tags `{project}@{version}`, and creates GitHub Releases.
   - **Binary build/upload:** for each Go project that was released this run,
     cross-compile the matrix (`linux/amd64`, `linux/arm64`, `darwin/arm64`) with
     the version ldflags and upload the assets to that project's versioned GitHub
     Release (asset names `status-monitor-<os>-<arch>` so #6's install-script
     `uname` mapping resolves them).
   - **Stable "latest" URL** (important with *independent* releasing): GitHub's
     `/releases/latest/` resolves to the newest release across **all** projects —
     which may be a different project — so it is **not** usable to fetch a specific
     binary. The release job therefore also force-updates a moving
     `status-monitor-latest` release/tag holding the newest assets, giving #6 a
     stable install URL: `releases/download/status-monitor-latest/status-monitor-<os>-<arch>`.
     (Equivalent alternative: the install script queries the public GitHub API for
     the newest `status-monitor@*` release; the moving tag is preferred so the
     script needs no JSON parsing.)
   - Runs with a token that may push the version commit + tags to protected
     `main` (a **GitHub App token or PAT** with `contents: write` and a
     branch-protection bypass) — see (F).

### F. Merge method, branch protection, release-push token (operational)

- Maintainer enables **Allow rebase merging** + **Allow fast-forward merging**,
  disables squash + merge-commit, on the GitHub repo.
- Branch protection on `main`: require the `ci.yml` checks; require linear
  history (consistent with rebase+ff).
- The release job needs to push to protected `main`; use a **GitHub App
  installation token** (preferred) or a PAT with `contents: write`, added to repo
  secrets, and granted a protection bypass for that actor. (The default
  `GITHUB_TOKEN` cannot push past branch protection.)

### G. Secrets (maintainer adds in GitHub)

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the release-push token
(`RELEASE_APP_ID`/`RELEASE_APP_PRIVATE_KEY` for a GitHub App, or
`RELEASE_TOKEN` PAT). Worker runtime secrets remain in `wrangler secret put` —
CI never handles them.

## Release / CI flow

PR opened → `ci.yml` (nx affected lint/test/build + commit-range lint) must pass
→ rebase+ff merge to `main` → on push: `deploy.yml` deploys changed Workers to
Cloudflare, and `release.yml` runs `nx release` (bumps only projects with
releasable commits → tags + GitHub releases + changelogs) then cross-compiles +
uploads `status-monitor` binaries to its release → #6's install script pulls them.

## Error handling / edge cases

- **No releasable commits** for a project → `nx release` makes no release for it
  (no-op); the workflow exits cleanly.
- **Non-conventional commit** in a PR → `ci.yml` commit-range lint fails the PR.
- **Deploy with nothing affected** → `nx affected -t deploy` is a no-op.
- **Release push blocked by branch protection** → mitigated by the App/PAT token
  (F); documented as a hard prerequisite.
- **Partial release failure** (tag created, asset upload fails) → the workflow
  fails loudly; re-run uploads to the existing release (idempotent asset upload).

## Testing / acceptance

- `commitlint` rejects a bad message locally (hook) and a CI run fails on a
  non-conventional commit in a PR; a conforming PR passes.
- `nx release --dry-run` on a branch with a `feat(status-monitor): …` commit
  shows a `status-monitor` minor bump and **no** bump for untouched projects
  (proves independent attribution).
- A Go build with the ldflags produces a binary whose `--version` prints the
  `VERSION` value.
- `ci.yml` runs `nx affected` lint/test/build green on a sample PR; caches hit on
  re-run.
- `deploy.yml` deploys `web` to Cloudflare on a main push that changed it (and is
  a no-op otherwise) — verified once with real secrets.
- `release.yml` produces a `status-monitor@x.y.z` GitHub Release with the three
  binary assets named for the matrix.

## Files (indicative)

| path | action |
|------|--------|
| `package.json` | edit — add commitlint/husky dev deps + `prepare` script |
| `commitlint.config.js` | create — extends config-conventional |
| `.husky/commit-msg` | create — runs commitlint |
| `nx.json` | edit — add the `release` block |
| `services/status-monitor/VERSION` | create — `0.0.0` seed |
| `services/status-monitor/main.go` | edit (coordinate with #6) — `var version` + `--version` flag |
| `.github/workflows/ci.yml` | create — affected lint/test/build + commit-range lint |
| `.github/workflows/deploy.yml` | create — affected deploy to Cloudflare |
| `.github/workflows/release.yml` | create — nx release + Go cross-compile/upload |
| `AGENTS.md` | edit — "Commits & PRs" section |

## Dependencies & sequencing

- **Independent of all feature sub-projects' code** — builds in parallel with #6.
- **Coupling with #6:** the `status-monitor` `VERSION`/`--version` wiring and the
  release-asset naming must match #6's install-script expectations
  (`status-monitor-<os>-<arch>`, `releases/latest/download/...`). Both specs fix
  that contract; whichever lands first, the other aligns to it. Until `release.yml`
  exists, #6 testing hand-cuts a release.
- **`mc-logparser`** (#7) slots into the same release matrix later (add its
  `VERSION` + a matrix entry).
- If the plan is large, the natural split is **(a)** commit enforcement + docs +
  `ci.yml` (fast, high-value, no secrets), **(b)** `nx release` + Go versioning +
  `release.yml`, **(c)** `deploy.yml`. Default: one plan; reassess at planning.
