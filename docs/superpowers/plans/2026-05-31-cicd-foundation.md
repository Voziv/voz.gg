# CI/CD Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the CI/CD foundation for the `voz.gg` nx polyglot monorepo — conventional-commit enforcement (local + CI), `nx release`-driven per-project versioning/changelogs/releases, Cloudflare deploys from `main`, and cross-compiled `status-monitor` binary publishing.

**Architecture:** Root dev-deps add commitlint + husky for author-time commit linting; a CI job lints the whole PR commit range (because merges are rebase + fast-forward). `nx release` runs with `projectsRelationship: independent` and `conventionalCommits`. TS projects version via `package.json`; Go projects version via a per-project `VERSION` file written from the `nx/release` programmatic API (`releaseVersion` returns each project's computed version), then embedded into the binary with `-ldflags "-X main.version=…"`. Three GitHub Actions workflows handle PR checks (`ci.yml`), Cloudflare deploy (`deploy.yml`), and release + binary publish (`release.yml`).

**Tech Stack:** nx 22.7.5, pnpm 11.5, Go 1.24 (single root `go.mod`, module `voz.gg`), `@commitlint/cli` + `@commitlint/config-conventional`, husky, `nx/release` programmatic API, GitHub Actions, `wrangler`, `actions/create-github-app-token`.

---

## Notes for the executor

- **Commit signing is unavailable in this environment.** Every commit command below uses `git -c commit.gpgsign=false commit -m "…"`. Do not drop that flag.
- **`actionlint` is not installed** in this environment. Workflow YAML is validated by structure review and a Node `js-yaml` parse step, not by `act` (also unavailable). If a later environment has `actionlint`, run it; otherwise the parse step is the gate.
- The `status-monitor` build target is currently `@nx-go/nx-go:build` with no ldflags. This plan adds version wiring **idempotently** — it replaces the executor with an explicit `go build` command that injects ldflags, so re-running is safe.
- Conventional-commit scope is **advisory** (recommended = a project name), not enforced as an enum, because `nx release` attributes bumps by changed files, not by the scope string.

---

## File structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `@commitlint/cli`, `@commitlint/config-conventional`, `husky` dev deps; add `prepare` script (`husky`); add `release` script (`node tools/release/release.mjs`). |
| `commitlint.config.js` | Create | Extends `@commitlint/config-conventional`; scope advisory; allowed types pinned. |
| `.husky/commit-msg` | Create | Author-time hook running `pnpm exec commitlint --edit "$1"`. |
| `nx.json` | Modify | Add the `release` block (independent, conventionalCommits, per-project changelogs, git commit+tag). |
| `tools/release/release.mjs` | Create | Programmatic `nx release` runner: computes versions, writes Go `VERSION` files from `projectsVersionData`, writes changelogs, commits + tags. |
| `services/status-monitor/VERSION` | Create | Seed `0.0.0`; the Go version source bumped by `nx release`. |
| `services/status-monitor/main.go` | Modify | Add `var version = "dev"` + a `--version` flag that prints it. |
| `services/status-monitor/version_test.go` | Create | Asserts the `--version` flag prints the embedded version. |
| `services/status-monitor/project.json` | Modify | Replace `build` executor with an explicit `go build` injecting `-ldflags "-X main.version=$(cat VERSION)"`. |
| `.github/workflows/ci.yml` | Create | PR + non-main push: setup + caches, `nx affected -t lint,test,build`, commit-range commitlint. |
| `.github/workflows/deploy.yml` | Create | Push `main`: `nx affected -t deploy` for `web`/`events-ingest` with Cloudflare secrets. |
| `.github/workflows/release.yml` | Create | Push `main`: mint App token, `pnpm nx release`, cross-compile + upload `status-monitor` binaries to its release and a moving `status-monitor-latest` release. |
| `AGENTS.md` | Modify | Add a concise "Commits & PRs" section. |

---

## Task 1: Add commitlint + husky dev deps and scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dev dependencies**

Run:

```bash
pnpm add -D -w @commitlint/cli@^20 @commitlint/config-conventional@^20 husky@^9
```

Expected: pnpm resolves and writes the three packages into root `devDependencies`; `pnpm-lock.yaml` updates. If `^20`/`^9` are unavailable in this registry, accept the latest majors pnpm resolves and note the resolved versions in the commit body.

- [ ] **Step 2: Add the `prepare` and `release` scripts**

Edit `package.json` so the `scripts` block reads exactly:

```json
  "scripts": {
    "build": "nx run-many -t build",
    "test": "nx run-many -t test",
    "lint": "nx run-many -t lint",
    "deploy": "nx run web:migrate && nx run-many -t deploy",
    "prepare": "husky",
    "release": "node tools/release/release.mjs"
  },
```

- [ ] **Step 3: Verify the deps and scripts landed**

Run:

```bash
node -e "const p=require('./package.json'); console.log(['@commitlint/cli','@commitlint/config-conventional','husky'].map(d=>d+': '+(p.devDependencies[d]||'MISSING')).join('\n')); console.log('prepare:', p.scripts.prepare); console.log('release:', p.scripts.release)"
```

Expected: each commitlint/husky dep prints a version (not `MISSING`); `prepare: husky`; `release: node tools/release/release.mjs`.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git -c commit.gpgsign=false commit -m "build: add commitlint and husky dev deps with prepare and release scripts"
```

---

## Task 2: Configure commitlint

**Files:**
- Create: `commitlint.config.js`

- [ ] **Step 1: Write the commitlint config**

Create `commitlint.config.js` with exactly:

```js
/**
 * Conventional-commit rules for the voz.gg monorepo.
 *
 * Scope is advisory: the recommended scope is a project name
 * (web, events-ingest, status-monitor, mc-logparser, shared, go-shared),
 * but it is NOT enforced as an enum because nx release attributes version
 * bumps by changed files, not by the scope string.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
  },
};
```

- [ ] **Step 2: Verify a conforming message passes**

Run:

```bash
echo "feat(status-monitor): add ping prober" | pnpm exec commitlint --verbose
```

Expected: exit 0; output includes `found 0 problems, 0 warnings` (an `input:` echo line may precede it).

- [ ] **Step 3: Verify a non-conforming message fails (TDD for the config)**

Run:

```bash
echo "added a thing" | pnpm exec commitlint; echo "exit=$?"
```

Expected: non-zero exit; output includes `type may not be empty` (and `subject may not be empty`); the final line prints `exit=1`.

- [ ] **Step 4: Verify a disallowed type fails**

Run:

```bash
echo "wip(web): half done" | pnpm exec commitlint; echo "exit=$?"
```

Expected: non-zero exit; output includes `type must be one of` listing the allowed types; `exit=1`.

- [ ] **Step 5: Commit**

```bash
git add commitlint.config.js
git -c commit.gpgsign=false commit -m "ci: add commitlint config extending config-conventional"
```

---

## Task 3: Add the husky commit-msg hook

**Files:**
- Create: `.husky/commit-msg`

- [ ] **Step 1: Initialize husky (creates `.husky/`)**

Run:

```bash
pnpm exec husky
```

Expected: exit 0; a `.husky/` directory and `.husky/_/` helper directory are created. (`pnpm exec husky` with no subcommand performs install in husky v9+.)

- [ ] **Step 2: Write the commit-msg hook**

Create `.husky/commit-msg` with exactly:

```sh
pnpm exec commitlint --edit "$1"
```

- [ ] **Step 3: Make the hook executable**

Run:

```bash
chmod +x .husky/commit-msg
```

Expected: no output; `test -x .husky/commit-msg && echo ok` prints `ok`.

- [ ] **Step 4: Verify the hook rejects a bad message (TDD for the hook)**

Run:

```bash
git commit --allow-empty -m "nope this is bad" 2>&1; echo "exit=$?"
```

Expected: the commit is **rejected**; output includes `type may not be empty`; `exit=1`. (No empty commit is created — confirm with `git log -1 --pretty=%s` showing the prior commit, not `nope this is bad`.)

- [ ] **Step 5: Verify the hook allows a good message**

Run:

```bash
git commit --allow-empty -m "chore: verify commit-msg hook accepts conventional messages" 2>&1; echo "exit=$?"
git reset --hard HEAD~1
```

Expected: the empty commit is **created** (`exit=0`), then removed by the reset so it does not pollute history.

- [ ] **Step 6: Commit the hook**

```bash
git add .husky/commit-msg
git -c commit.gpgsign=false commit -m "ci: add husky commit-msg hook running commitlint"
```

(The `.husky/_/` directory is git-ignored by husky's own generated `.gitignore`; only `.husky/commit-msg` is tracked. If `git status` shows `.husky/_/`, do not add it.)

---

## Task 4: Add the `nx release` block to `nx.json`

**Files:**
- Modify: `nx.json`

- [ ] **Step 1: Add the `release` key**

Edit `nx.json` to add a top-level `"release"` key (sibling of `"plugins"`). The full file becomes exactly:

```json
{
  "$schema": "node_modules/nx/schemas/nx-schema.json",
  "namedInputs": {
    "default": [
      "{projectRoot}/**/*"
    ],
    "production": [
      "default"
    ]
  },
  "targetDefaults": {
    "build": {
      "dependsOn": [
        "^build"
      ],
      "cache": true
    },
    "test": {
      "cache": true
    },
    "lint": {
      "cache": true
    }
  },
  "workspaceLayout": {
    "appsDir": "apps",
    "libsDir": "libs"
  },
  "plugins": [
    "@nx-go/nx-go",
    {
      "plugin": "@nx/eslint/plugin",
      "options": {
        "targetName": "lint"
      }
    }
  ],
  "release": {
    "projectsRelationship": "independent",
    "releaseTagPattern": "{projectName}@{version}",
    "version": {
      "conventionalCommits": true
    },
    "changelog": {
      "projectChangelogs": true,
      "workspaceChangelog": false
    },
    "git": {
      "commit": true,
      "tag": true
    }
  },
  "analytics": false
}
```

- [ ] **Step 2: Verify nx parses the release config**

Run:

```bash
npx nx show projects --json >/dev/null && node -e "const n=require('./nx.json'); const r=n.release; if(r.projectsRelationship!=='independent'||r.releaseTagPattern!=='{projectName}@{version}'||!r.version.conventionalCommits||!r.changelog.projectChangelogs||r.changelog.workspaceChangelog!==false||!r.git.commit||!r.git.tag){throw new Error('release config wrong')} console.log('release config ok')"
```

Expected: `release config ok`; `nx show projects` exits 0 (proves `nx.json` is still valid JSON nx accepts).

- [ ] **Step 3: Commit**

```bash
git add nx.json
git -c commit.gpgsign=false commit -m "ci: add nx release config for independent per-project releases"
```

---

## Task 5: Add the status-monitor VERSION file and `--version` flag

**Files:**
- Create: `services/status-monitor/VERSION`
- Modify: `services/status-monitor/main.go`
- Create: `services/status-monitor/version_test.go`

- [ ] **Step 1: Seed the VERSION file**

Create `services/status-monitor/VERSION` with exactly this single line (terminated by one newline):

```
0.0.0
```

- [ ] **Step 2: Write the failing version test (TDD)**

Create `services/status-monitor/version_test.go` with exactly:

```go
package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

// TestVersionFlagPrintsLdflagVersion builds the binary with an injected
// version and asserts the --version flag prints exactly that value.
func TestVersionFlagPrintsLdflagVersion(t *testing.T) {
	bin := t.TempDir() + "/status-monitor"
	build := exec.Command("go", "build",
		"-ldflags", "-X main.version=9.9.9-test",
		"-o", bin, ".")
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		t.Fatalf("build failed: %v", err)
	}

	out, err := exec.Command(bin, "--version").CombinedOutput()
	if err != nil {
		t.Fatalf("run --version failed: %v (output: %s)", err, out)
	}
	if got := strings.TrimSpace(string(out)); got != "9.9.9-test" {
		t.Fatalf("--version printed %q, want %q", got, "9.9.9-test")
	}
}
```

- [ ] **Step 3: Run the test to confirm it fails**

Run:

```bash
go test ./services/status-monitor/ -run TestVersionFlagPrintsLdflagVersion -v
```

Expected: FAIL — the current `main.go` has no `version` var and no `--version` flag, so the flag is unhandled and the binary prints the stub line instead of `9.9.9-test`. Confirm the failure message mentions the printed stub text, not `9.9.9-test`.

- [ ] **Step 4: Implement `var version` + `--version` flag**

Replace the entire contents of `services/status-monitor/main.go` with exactly:

```go
// Command status-monitor is a stub for the Minecraft server status reporter.
// Real ping logic arrives in the server-status-monitoring sub-project.
package main

import (
	"flag"
	"fmt"

	goshared "voz.gg/libs/go-shared"
)

// version is injected at build time via -ldflags "-X main.version=<v>",
// sourced from the project's VERSION file. It defaults to "dev" for local builds.
var version = "dev"

func statusEvent(host string) goshared.Event {
	return goshared.NewEvent(goshared.EventPlayerJoin, host)
}

func main() {
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	fmt.Println("status-monitor stub: daemon would poll game servers here")
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run:

```bash
go test ./services/status-monitor/ -run TestVersionFlagPrintsLdflagVersion -v
```

Expected: PASS (`--version` prints `9.9.9-test`).

- [ ] **Step 6: Confirm the existing stub test still passes**

Run:

```bash
go test ./services/status-monitor/ -v
```

Expected: PASS for both `TestStatusEventUsesSharedLib` and `TestVersionFlagPrintsLdflagVersion`.

- [ ] **Step 7: Commit**

```bash
git add services/status-monitor/VERSION services/status-monitor/main.go services/status-monitor/version_test.go
git -c commit.gpgsign=false commit -m "feat(status-monitor): add VERSION file and --version flag"
```

---

## Task 6: Wire version ldflags into the status-monitor build target

**Files:**
- Modify: `services/status-monitor/project.json`

- [ ] **Step 1: Replace the build target with an ldflags-injecting `go build`**

Edit `services/status-monitor/project.json` so the full file reads exactly:

```json
{
  "name": "status-monitor",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "services/status-monitor",
  "tags": ["type:service", "lang:go"],
  "targets": {
    "build": {
      "command": "go build -ldflags \"-X main.version=$(cat VERSION)\" -o dist/status-monitor .",
      "options": { "cwd": "services/status-monitor" },
      "outputs": ["{projectRoot}/dist"]
    },
    "serve": { "executor": "@nx-go/nx-go:serve" },
    "test": { "executor": "@nx-go/nx-go:test" },
    "lint": { "executor": "@nx-go/nx-go:lint" }
  }
}
```

- [ ] **Step 2: Build via nx and confirm the version is embedded**

Run:

```bash
npx nx build status-monitor && ./services/status-monitor/dist/status-monitor --version
```

Expected: nx build succeeds; `--version` prints `0.0.0` (the seeded VERSION). This proves the `$(cat VERSION)` ldflags wiring works through nx.

- [ ] **Step 3: Ignore the build output**

Run:

```bash
node -e "const fs=require('fs');const p='.gitignore';let s=fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';if(!s.split(/\r?\n/).includes('services/status-monitor/dist')){s=s.replace(/\s*$/,'')+'\nservices/status-monitor/dist\n';fs.writeFileSync(p,s);console.log('added ignore')}else{console.log('already ignored')}"
```

Expected: prints `added ignore` (or `already ignored` if a prior run added it). Confirm `git status` does not list `services/status-monitor/dist/`.

- [ ] **Step 4: Commit**

```bash
git add services/status-monitor/project.json .gitignore
git -c commit.gpgsign=false commit -m "ci(status-monitor): inject version ldflags into nx build target"
```

---

## Task 7: Add the programmatic release runner (Go VERSION sync)

**Files:**
- Create: `tools/release/release.mjs`

**Why a script, not raw `nx release`:** nx's built-in `conventionalCommits` versioning bumps `package.json` for JS projects, but Go projects have no `package.json` for nx to write. The robust mechanism is the `nx/release` programmatic API: `releaseVersion()` returns `projectsVersionData` mapping each project to its computed `newVersion`. The script writes that version into each Go project's `VERSION` file **before** the changelog/commit/tag step, so the `VERSION` change is captured in the same release commit and tag. JS projects are handled natively by `releaseVersion`.

- [ ] **Step 1: Write the release runner**

Create `tools/release/release.mjs` with exactly:

```js
#!/usr/bin/env node
/**
 * Programmatic nx release runner.
 *
 * nx release's conventionalCommits versioning bumps package.json for JS
 * projects but has no manifest to write for Go projects. This script runs
 * releaseVersion to compute per-project versions, writes the computed version
 * into each Go project's VERSION file, then runs releaseChangelog so the
 * VERSION change, changelog, commit, and tag all land together.
 *
 * Go projects are identified as projects with a VERSION file and no
 * package.json at their root.
 *
 * Usage:
 *   node tools/release/release.mjs            # real release
 *   node tools/release/release.mjs --dry-run  # compute + preview, no writes/tags
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProjectGraphAsync } from '@nx/devkit';
import { releaseChangelog, releaseVersion } from 'nx/release';

const dryRun = process.argv.includes('--dry-run');

async function run() {
  const graph = await createProjectGraphAsync({ exitOnError: true });

  const { workspaceVersion, projectsVersionData } = await releaseVersion({
    dryRun,
    verbose: true,
  });

  for (const [projectName, data] of Object.entries(projectsVersionData)) {
    const newVersion = data?.newVersion;
    if (!newVersion) {
      continue; // no releasable commits for this project
    }
    const root = graph.nodes[projectName]?.data?.root;
    if (!root) {
      continue;
    }
    const versionFile = join(root, 'VERSION');
    const hasVersionFile = existsSync(versionFile);
    const hasPackageJson = existsSync(join(root, 'package.json'));
    if (hasVersionFile && !hasPackageJson) {
      if (dryRun) {
        console.log(`[dry-run] would write ${newVersion} to ${versionFile}`);
      } else {
        writeFileSync(versionFile, `${newVersion}\n`);
        console.log(`wrote ${newVersion} to ${versionFile}`);
      }
    }
  }

  await releaseChangelog({
    dryRun,
    verbose: true,
    versionData: projectsVersionData,
    version: workspaceVersion,
  });

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Confirm `@nx/devkit` is resolvable**

Run:

```bash
node -e "require.resolve('@nx/devkit'); require.resolve('nx/release'); console.log('imports resolvable')"
```

Expected: `imports resolvable`. If `@nx/devkit` is not present, run `pnpm add -D -w @nx/devkit@22.7.5` and amend Task 1's commit note; `nx/release` ships with `nx` (already installed).

- [ ] **Step 3: Syntax-check the script**

Run:

```bash
node --check tools/release/release.mjs && echo "syntax ok"
```

Expected: `syntax ok`.

- [ ] **Step 4: Commit**

```bash
git add tools/release/release.mjs
git -c commit.gpgsign=false commit -m "ci: add programmatic nx release runner syncing Go VERSION files"
```

(If Step 2 required adding `@nx/devkit`, also `git add package.json pnpm-lock.yaml` in this commit.)

---

## Task 8: Verify independent versioning with a dry-run

This task proves the acceptance criterion: a `feat(status-monitor): …` commit yields a `status-monitor` minor bump and **no** bump for untouched projects. It uses a throwaway branch + commit and leaves no trace.

**Files:** none created (verification only).

- [ ] **Step 1: Create a throwaway branch with a releasable Go-scoped commit**

Run:

```bash
git checkout -b release-dryrun-check
git commit --allow-empty -m "feat(status-monitor): trigger a dry-run minor bump"
```

Expected: branch created; empty commit accepted by the commit-msg hook.

- [ ] **Step 2: Run the release runner in dry-run mode**

Run:

```bash
node tools/release/release.mjs --dry-run 2>&1 | tee /tmp/release-dryrun.log
```

Expected: the log shows a computed `status-monitor` version bump from `0.0.0` to `0.1.0` (minor, because `feat`), a `[dry-run] would write 0.1.0 to services/status-monitor/VERSION` line, and a changelog preview. It must **not** show bumps for `web`, `events-ingest`, `shared`, or `go-shared` (no commits touched them). No tags are created, no files written (dry-run).

- [ ] **Step 3: Confirm no files were modified and no tags created**

Run:

```bash
git status --porcelain && git tag --list "status-monitor@*"
```

Expected: empty output for both (dry-run wrote nothing and created no tag). `VERSION` still reads `0.0.0`.

- [ ] **Step 4: Clean up the throwaway branch**

Run:

```bash
git checkout main && git branch -D release-dryrun-check
```

Expected: back on `main`; throwaway branch deleted. (No commit in this task — it is verification only.)

---

## Task 9: Add the CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the CI workflow**

Create `.github/workflows/ci.yml` with exactly:

```yaml
name: CI

on:
  pull_request:
  push:
    branches-ignore:
      - main

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  affected:
    name: Lint, test, build (affected)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - uses: actions/setup-go@v5
        with:
          go-version: "1.24"
          cache: true

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Cache nx
        uses: actions/cache@v4
        with:
          path: .nx/cache
          key: nx-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-${{ github.sha }}
          restore-keys: |
            nx-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-
            nx-${{ runner.os }}-

      - name: Derive nx SHAs
        uses: nrwl/nx-set-shas@v4

      - name: Lint, test, build affected projects
        run: pnpm exec nx affected -t lint test build

      - name: Lint commit range
        if: github.event_name == 'pull_request'
        run: >-
          pnpm exec commitlint
          --from "${{ github.event.pull_request.base.sha }}"
          --to "${{ github.event.pull_request.head.sha }}"
          --verbose
```

- [ ] **Step 2: Validate the YAML parses (actionlint unavailable)**

Run:

```bash
node -e "const y=require('js-yaml');const fs=require('fs');y.load(fs.readFileSync('.github/workflows/ci.yml','utf8'));console.log('ci.yml valid yaml')"
```

Expected: `ci.yml valid yaml`. If `js-yaml` cannot resolve, install it with `pnpm add -D -w js-yaml` and re-run. If `actionlint` happens to be installed, also run `actionlint .github/workflows/ci.yml`.

- [ ] **Step 3: Confirm `nx affected` runs locally (graph sanity)**

Run:

```bash
npx nx affected -t build --base=HEAD~1 --head=HEAD --dry-run 2>&1 | tail -20
```

Expected: nx prints the affected task graph (or "No projects with target build were run" if nothing is affected) and exits 0 — proving the `nx affected` invocation in the workflow is well-formed.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git -c commit.gpgsign=false commit -m "ci: add PR workflow for affected lint/test/build and commit-range lint"
```

---

## Task 10: Add the deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Verified target names:** `web` and `events-ingest` both define a `deploy` target in their `project.json` (`web` -> `wrangler deploy --config dist/server/wrangler.json` after `build`; `events-ingest` -> `wrangler deploy`). `nx affected -t deploy` therefore resolves to exactly these two Workers.

- [ ] **Step 1: Write the deploy workflow**

Create `.github/workflows/deploy.yml` with exactly:

```yaml
name: Deploy

on:
  push:
    branches:
      - main

concurrency:
  group: deploy-main
  cancel-in-progress: false

jobs:
  deploy:
    name: Deploy affected Workers
    runs-on: ubuntu-latest
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Cache nx
        uses: actions/cache@v4
        with:
          path: .nx/cache
          key: nx-deploy-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-${{ github.sha }}
          restore-keys: |
            nx-deploy-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-
            nx-deploy-${{ runner.os }}-

      - name: Derive nx SHAs
        uses: nrwl/nx-set-shas@v4

      - name: Deploy affected Workers
        run: pnpm exec nx affected -t deploy
```

- [ ] **Step 2: Validate the YAML parses**

Run:

```bash
node -e "const y=require('js-yaml');const fs=require('fs');y.load(fs.readFileSync('.github/workflows/deploy.yml','utf8'));console.log('deploy.yml valid yaml')"
```

Expected: `deploy.yml valid yaml`.

- [ ] **Step 3: Confirm `web` and `events-ingest` are the deploy targets**

Run:

```bash
npx nx show projects --with-target deploy
```

Expected: lists exactly `web` and `events-ingest` (order may vary) — confirming `nx affected -t deploy` targets the right Workers.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml
git -c commit.gpgsign=false commit -m "ci: add deploy workflow for affected Cloudflare Workers on main"
```

---

## Task 11: Add the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Asset-name contract (fixed with #6):** binaries are named `status-monitor-<os>-<arch>` where `<os>` is `linux` or `darwin` and `<arch>` is `amd64` or `arm64`. The matrix is `linux/amd64`, `linux/arm64`, `darwin/arm64`. #6's install script fetches the stable URL `releases/download/status-monitor-latest/status-monitor-<os>-<arch>`.

- [ ] **Step 1: Write the release workflow**

Create `.github/workflows/release.yml` with exactly:

```yaml
name: Release

on:
  push:
    branches:
      - main

concurrency:
  group: release-main
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  release:
    name: Version, changelog, tag, GitHub release
    runs-on: ubuntu-latest
    outputs:
      status_monitor_version: ${{ steps.smver.outputs.version }}
      status_monitor_released: ${{ steps.smver.outputs.released }}
    steps:
      - name: Mint GitHub App token
        id: app-token
        uses: actions/create-github-app-token@v3
        with:
          app-id: ${{ vars.VOZ_GG_APP_CLIENT_ID }}
          private-key: ${{ secrets.VOZ_GG_APP_PRIVATE_KEY }}

      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ steps.app-token.outputs.token }}

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Configure git author
        run: |
          git config user.name "voz-gg-release[bot]"
          git config user.email "voz-gg-release[bot]@users.noreply.github.com"

      - name: Run nx release
        env:
          GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
        run: pnpm nx release --yes

      - name: Detect status-monitor release
        id: smver
        run: |
          version="$(cat services/status-monitor/VERSION)"
          tag="status-monitor@${version}"
          if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
            # Treat it as released this run only if the tag points at HEAD.
            if [ "$(git rev-list -n1 "${tag}")" = "$(git rev-parse HEAD)" ]; then
              echo "released=true" >> "$GITHUB_OUTPUT"
            else
              echo "released=false" >> "$GITHUB_OUTPUT"
            fi
          else
            echo "released=false" >> "$GITHUB_OUTPUT"
          fi
          echo "version=${version}" >> "$GITHUB_OUTPUT"

  publish-status-monitor:
    name: Cross-compile and publish status-monitor binaries
    needs: release
    if: needs.release.outputs.status_monitor_released == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    env:
      VERSION: ${{ needs.release.outputs.status_monitor_version }}
      GH_TOKEN: ${{ github.token }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: status-monitor@${{ needs.release.outputs.status_monitor_version }}

      - uses: actions/setup-go@v5
        with:
          go-version: "1.24"
          cache: true

      - name: Cross-compile binaries
        run: |
          set -euo pipefail
          mkdir -p dist
          build() {
            local os="$1" arch="$2"
            GOOS="$os" GOARCH="$arch" CGO_ENABLED=0 \
              go build -ldflags "-X main.version=${VERSION}" \
              -o "dist/status-monitor-${os}-${arch}" \
              ./services/status-monitor
          }
          build linux amd64
          build linux arm64
          build darwin arm64

      - name: Verify embedded version
        run: |
          set -euo pipefail
          printed="$(./dist/status-monitor-linux-amd64 --version || true)"
          echo "linux/amd64 binary --version => ${printed}"
          # Cannot run arm64/darwin on this runner; linux/amd64 is the smoke test.
          test "${printed}" = "${VERSION}"

      - name: Upload assets to versioned release
        run: |
          set -euo pipefail
          gh release upload "status-monitor@${VERSION}" \
            dist/status-monitor-linux-amd64 \
            dist/status-monitor-linux-arm64 \
            dist/status-monitor-darwin-arm64 \
            --clobber

      - name: Force-update moving status-monitor-latest release
        run: |
          set -euo pipefail
          tag="status-monitor-latest"
          # Move the tag to the current commit and push it (force).
          git tag -f "${tag}"
          git push -f origin "refs/tags/${tag}"
          if gh release view "${tag}" >/dev/null 2>&1; then
            gh release edit "${tag}" --target "$(git rev-parse HEAD)" \
              --title "status-monitor (latest)" \
              --notes "Moving pointer to the newest status-monitor release (${VERSION})."
          else
            gh release create "${tag}" \
              --title "status-monitor (latest)" \
              --notes "Moving pointer to the newest status-monitor release (${VERSION})." \
              --target "$(git rev-parse HEAD)"
          fi
          gh release upload "${tag}" \
            dist/status-monitor-linux-amd64 \
            dist/status-monitor-linux-arm64 \
            dist/status-monitor-darwin-arm64 \
            --clobber
```

- [ ] **Step 2: Validate the YAML parses**

Run:

```bash
node -e "const y=require('js-yaml');const fs=require('fs');y.load(fs.readFileSync('.github/workflows/release.yml','utf8'));console.log('release.yml valid yaml')"
```

Expected: `release.yml valid yaml`.

- [ ] **Step 3: Confirm the cross-compile recipe works locally (toolchain smoke test)**

Run:

```bash
VERSION=1.2.3 bash -c 'set -euo pipefail; mkdir -p /tmp/sm-dist; GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-X main.version=${VERSION}" -o /tmp/sm-dist/status-monitor-linux-amd64 ./services/status-monitor && echo built'
```

Expected: `built` — confirms the `GOOS`/`GOARCH`/ldflags command in the workflow compiles. (The produced binary is linux; it is not run here, only built.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git -c commit.gpgsign=false commit -m "ci: add release workflow for nx release and status-monitor binaries"
```

---

## Task 12: Document Commits & PRs in AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the "Commits & PRs" section**

Insert a new `## Commits & PRs` section into `AGENTS.md` immediately **after** the `## Tags & boundaries` section and **before** `## Cloudflare / data`. The exact text to insert:

```markdown
## Commits & PRs

Conventional commits are mandatory: `<type>(<scope>): <subject>`.

- **Types:** `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- **Scope (recommended):** a project name — `web`, `events-ingest`, `status-monitor`, `mc-logparser`, `shared`, `go-shared`. Omit the scope for repo-wide changes. Scope is advisory, not enforced as an enum.
- **Subject:** imperative mood ("add" not "added"), no trailing period, ~50 chars.
- **Enforcement:** a local `commit-msg` hook (husky + commitlint) rejects bad messages at author time; CI re-lints **every commit** in the PR range.
- **Merge model:** rebase + fast-forward (no squash, no merge commits), so **every** commit lands on `main` individually and must comply. `nx release` attributes version bumps to a project by the files each commit changes — granular, well-scoped commits drive accurate independent per-project versioning; a broad multi-project commit bumps every project it touches.
```

- [ ] **Step 2: Verify placement and content**

Run:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('AGENTS.md','utf8');const i=s.indexOf('## Commits & PRs');const j=s.indexOf('## Tags & boundaries');const k=s.indexOf('## Cloudflare / data');if(i<0)throw new Error('section missing');if(!(j<i&&i<k))throw new Error('section misplaced');if(!/rebase \+ fast-forward/.test(s))throw new Error('merge model missing');console.log('Commits & PRs section ok')"
```

Expected: `Commits & PRs section ok`.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git -c commit.gpgsign=false commit -m "docs: add Commits & PRs section to AGENTS.md"
```

---

## Task 13: Final verification

This task confirms the whole foundation is internally consistent. No new files; verification + a summary commit only if anything was fixed.

**Files:** none (verification).

- [ ] **Step 1: All workflows are valid YAML**

Run:

```bash
for f in .github/workflows/ci.yml .github/workflows/deploy.yml .github/workflows/release.yml; do
  node -e "const y=require('js-yaml');const fs=require('fs');y.load(fs.readFileSync('$f','utf8'));console.log('$f ok')"
done
```

Expected: three `… ok` lines. If `actionlint` is available in this environment, also run `actionlint .github/workflows/*.yml` and expect no errors.

- [ ] **Step 2: commitlint still gates messages both ways**

Run:

```bash
echo "feat(web): add dashboard route" | pnpm exec commitlint --verbose && echo "GOOD-PASSED"
echo "broken message" | pnpm exec commitlint; echo "BAD-exit=$?"
```

Expected: `GOOD-PASSED` printed; the broken message prints `BAD-exit=1`.

- [ ] **Step 3: nx release dry-run is clean on `main`**

Run:

```bash
node tools/release/release.mjs --dry-run 2>&1 | tail -15
```

Expected: completes without error. With no new releasable commits since the last tags it reports no bumps; if recent `feat`/`fix` commits exist it previews them. No files modified — confirm with `git status --porcelain` (empty).

- [ ] **Step 4: status-monitor binary self-identifies via nx build**

Run:

```bash
npx nx build status-monitor && ./services/status-monitor/dist/status-monitor --version
```

Expected: prints `0.0.0` (current VERSION seed).

- [ ] **Step 5: Affected graph resolves for all task types**

Run:

```bash
npx nx affected -t lint test build deploy --base=HEAD~1 --head=HEAD --dry-run 2>&1 | tail -20
```

Expected: nx prints a coherent task graph (or "no projects" messages) and exits 0 — proving every workflow's `nx affected` invocation is well-formed against the real project graph.

- [ ] **Step 6: Confirm the working tree is clean**

Run:

```bash
git status --porcelain
```

Expected: empty output. If any verification step left stray artifacts (e.g. `dist/`), confirm they are git-ignored. No commit is needed for this task unless a fix was applied; if a fix was applied, commit it with an appropriate `ci:` or `fix:` conventional message using `git -c commit.gpgsign=false commit -m "…"`.

---

## Operational prerequisites (maintainer, GitHub UI — not scripted here)

These are required for the workflows to function but are configured by the maintainer in GitHub, per the spec's non-goals:

- **Repo merge settings:** enable *Allow rebase merging* + *Allow fast-forward merging*; disable squash and merge-commit.
- **Branch protection on `main`:** require the `CI` workflow checks; require linear history.
- **GitHub App** with **Contents: Read and write**, added to the `main` ruleset **bypass list** (so the release job can push the version commit + tags past protection).
- **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VOZ_GG_APP_PRIVATE_KEY`.
- **Actions variable:** `VOZ_GG_APP_CLIENT_ID` (the App's client id — a variable, not a secret).
- Worker runtime secrets stay in `wrangler secret put`; CI never handles them.
