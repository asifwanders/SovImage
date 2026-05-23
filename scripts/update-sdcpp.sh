#!/usr/bin/env bash
# Bump the pinned stable-diffusion.cpp commit. Run locally, review the diff,
# commit. Never executed by CI — keeps upstream churn out of release builds.
#
# Usage:
#   scripts/update-sdcpp.sh                  # bumps to upstream master HEAD
#   scripts/update-sdcpp.sh <commit-ish>     # bumps to a specific ref/tag

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUB="$REPO_ROOT/vendor/stable-diffusion.cpp"
TARGET="${1:-origin/master}"

if [[ ! -d "$SUB/.git" && ! -f "$SUB/.git" ]]; then
  echo "submodule not initialized; running: git submodule update --init --recursive"
  git -C "$REPO_ROOT" submodule update --init --recursive
fi

git -C "$SUB" fetch --tags origin
git -C "$SUB" checkout "$TARGET"
NEW_SHA="$(git -C "$SUB" rev-parse HEAD)"
echo "stable-diffusion.cpp pinned at $NEW_SHA"
echo "next: git add vendor/stable-diffusion.cpp && git commit -m 'vendor: bump sd.cpp to ${NEW_SHA:0:12}'"
