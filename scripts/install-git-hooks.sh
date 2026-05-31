#!/usr/bin/env bash
#
# Install the repo's tracked git hooks (.githooks/) into this checkout's active
# hooks directory.
#
# Safe to run from any worktree: hooks resolve to the shared common git dir, so
# a single install covers the main checkout and every linked worktree. Any
# existing `core.hooksPath` setting is respected. Re-run after pulling hook
# changes.
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
source_dir="$repo_root/.githooks"

hooks_dir=$(git rev-parse --git-path hooks)
case "$hooks_dir" in
  /*) ;;                          # already absolute
  *) hooks_dir="$repo_root/$hooks_dir" ;;
esac

if [ ! -d "$source_dir" ]; then
  echo "error: $source_dir not found" >&2
  exit 1
fi

mkdir -p "$hooks_dir"
for hook in "$source_dir"/*; do
  [ -f "$hook" ] || continue
  install -m 0755 "$hook" "$hooks_dir/$(basename "$hook")"
  echo "installed: $(basename "$hook") -> $hooks_dir/$(basename "$hook")"
done

echo "Git hooks installed. They apply to this repo and all its worktrees."
