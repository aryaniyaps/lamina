#!/usr/bin/env bash
# Run skills CLI installs from evals/harness-sandbox so agent dirs never land at repo root.
set -euo pipefail

LAMINA_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX="$LAMINA_ROOT/evals/harness-sandbox"

mkdir -p "$SANDBOX"

EXTERNAL_SKILLS_ROOT="$(cd "$LAMINA_ROOT/../skills" && pwd)"

skills_add() {
  (cd "$SANDBOX" && npx --yes skills add "$LAMINA_ROOT" "$@")
}

skills_add_external() {
  (cd "$SANDBOX" && npx --yes skills add "$EXTERNAL_SKILLS_ROOT" --skill '*' -a cursor -y --copy "$@")
}

skills_dry_run() {
  (cd "$SANDBOX" && npx --yes skills add "$LAMINA_ROOT" "$@")
}
