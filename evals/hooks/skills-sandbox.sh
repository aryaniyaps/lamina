#!/usr/bin/env bash
# Run skills CLI installs from evals/harness-sandbox so agent dirs never land at repo root.
set -euo pipefail

LAMINA_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX="$LAMINA_ROOT/evals/harness-sandbox"

mkdir -p "$SANDBOX"

skills_add() {
  (cd "$SANDBOX" && npx --yes skills add "$LAMINA_ROOT" "$@")
}

skills_dry_run() {
  (cd "$SANDBOX" && npx --yes skills add "$LAMINA_ROOT" "$@")
}
