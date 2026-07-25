#!/usr/bin/env bash
# Run skills CLI installs from evals/harness-sandbox so agent dirs never land at repo root.
set -euo pipefail

LAMINA_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX="$LAMINA_ROOT/evals/harness-sandbox"

mkdir -p "$SANDBOX"

EXTERNAL_SKILLS_ROOT="$(cd "$LAMINA_ROOT/../skills" && pwd)"

skills_add() {
  local args=("$@")
  local has_skill=false
  for arg in "${args[@]}"; do
    if [[ "$arg" == "-s" || "$arg" == "--skill" ]]; then
      has_skill=true
      break
    fi
  done
  if [[ "$has_skill" == false ]]; then
    args=(--skill '*' "${args[@]}")
  fi
  (cd "$SANDBOX" && npx --yes skills add "$LAMINA_ROOT" "${args[@]}")
}

skills_add_external() {
  (cd "$SANDBOX" && npx --yes skills add "$EXTERNAL_SKILLS_ROOT" --skill '*' -a cursor -y --copy "$@")
}

skills_dry_run() {
  (cd "$SANDBOX" && npx --yes skills add "$LAMINA_ROOT" "$@")
}
