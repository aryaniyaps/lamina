#!/usr/bin/env bash
# Remove skills CLI agent dirs accidentally installed at the Lamina repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DIRS=(
  .agents
  .windsurf
  .claude
  .roo
  .pi
  .goose
  .cursor/skills
)

removed=0
for dir in "${DIRS[@]}"; do
  if [[ -e "$dir" ]]; then
    rm -rf "$dir"
    echo "Removed $dir"
    ((removed++)) || true
  fi
done

if [[ -f skills-lock.json ]]; then
  rm -f skills-lock.json
  echo "Removed skills-lock.json"
  ((removed++)) || true
fi

if [[ $removed -eq 0 ]]; then
  echo "No root-level skills CLI pollution found."
else
  echo "Cleaned $removed item(s). Eval installs should use evals/harness-sandbox/ only."
fi
