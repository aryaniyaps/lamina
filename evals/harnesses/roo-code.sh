#!/usr/bin/env bash
# Tier 2 harness adapter for Roo Code.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACTION="${1:-install}"

# shellcheck source=../hooks/skills-sandbox.sh
source "$ROOT/evals/hooks/skills-sandbox.sh"

case "$ACTION" in
  install)
    skills_add -a roo -y
    ;;
  run)
    PROMPT="${2:?prompt required}"
    echo "Roo Code harness: run via IDE with prompt: $PROMPT" >&2
    exit 127
    ;;
  *)
    echo "Usage: roo-code.sh {install|run <prompt>}" >&2
    exit 1
    ;;
esac
