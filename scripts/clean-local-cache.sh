#!/usr/bin/env bash
# Remove gitignored local benchmark/eval caches. Safe to run anytime.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

remove_if_exists() {
  if [[ -e "$1" ]]; then
    rm -rf "$1"
    echo "removed $1"
  fi
}

remove_if_exists jobs
remove_if_exists eval-workspace
remove_if_exists benchmarks/tmp
remove_if_exists benchmarks/results/v2
remove_if_exists benchmarks/results/raw/workspaces
remove_if_exists benchmarks/results/raw/artifacts
remove_if_exists evals/workspace
remove_if_exists evals/tmp
remove_if_exists evals/portable
remove_if_exists .worktrees

echo "Local cache cleanup complete."
