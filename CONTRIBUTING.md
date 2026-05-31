# Contributing to voz.gg

Thanks for your interest in contributing. This document explains the licensing
ground rules and how to get a change merged.

## Licensing and the CLA

voz.gg is released to the public under the
[PolyForm Noncommercial License 1.0.0](./LICENSE.md), which permits
noncommercial use only. The Project Owner (Lee Robert) retains copyright and
may additionally offer the Project under separate commercial license terms.

To keep that dual-licensing model intact, **every contributor must sign the
[Individual Contributor License Agreement](./CLA.md) (CLA)** before their
contribution can be merged. The CLA grants the Project Owner the right to
relicense contributions, including under commercial terms. You keep ownership
of your work; you are simply granting these licenses.

### Signing is automatic

You do not need to sign anything in advance. When you open your first pull
request, the CLA Assistant bot checks whether you have signed. If not, it
comments on the PR and you sign by posting this exact comment:

> I have read the CLA Document and I hereby sign the CLA

The bot then records your signature and the status check passes. The signature
covers all your present and future contributions, so you only sign once.

If you are contributing as part of your employment, make sure your employer
permits it (see Section 5 of the [CLA](./CLA.md)); corporate contributions may
require a separate Corporate CLA — open an issue to arrange one.

### Signing your commits (DCO)

In addition to the one-time CLA, **every commit must be signed off** under the
[Developer Certificate of Origin](./DCO) (DCO). The sign-off is your statement
that you have the right to submit the commit under the project's license. Add it
automatically with the `-s` flag:

```sh
git commit -s -m "feat(web): add server status badge"
```

This appends a line to the commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and email must match your `git config user.name` and
`git config user.email`. A DCO check runs on every pull request and blocks
merge until all commits are signed off. To sign off commits you already made,
amend the last one with `git commit --amend -s --no-edit`, or for a range use
`git rebase --signoff <base>`.

## Making a change

1. Fork the repository and create a topic branch off `main`.
2. Make your change. Keep commits atomic, self-explanatory, and **signed off**
   (`git commit -s`).
3. Ensure the affected projects build, test, and lint:
   ```sh
   nx affected -t build,test,lint
   ```
4. Open a pull request against `main`. Sign the CLA when prompted and make sure
   the DCO check passes.

## Conventions

This is an NX polyglot monorepo. See [AGENTS.md](./AGENTS.md) for project
structure, commands, and architecture notes before making larger changes.

- **Language:** English only — code, comments, docs, commit messages, and tests.
- **Commits:** Conventional Commits format — `<type>(<scope>): <subject>`, where
  `type` is one of `ci|feat|fix|docs|style|refactor|test|chore|perf`. Use the
  imperative mood ("add" not "added"), 50 characters max in the subject, no
  trailing period. Add a body for non-trivial changes explaining what and why.
- **Code style:** Prefer self-documenting code; comment only where intent is
  not obvious from names and structure.

## Reporting issues

Open a GitHub issue with enough detail to reproduce: what you expected, what
happened, and the relevant project (`apps/web`, a service, a tool, etc.).
