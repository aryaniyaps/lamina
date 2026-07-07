#!/usr/bin/env bash
# Tier 2 harness adapter for GitHub Copilot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACTION="${1:-install}"

# shellcheck source=../hooks/skills-sandbox.sh
source "$ROOT/evals/hooks/skills-sandbox.sh"

case "$ACTION" in
  install)
    skills_add -a github-copilot -y
    ;;
  run)
    PROMPT="${2:?prompt required}"
    echo "Copilot harness: run via IDE with prompt: $PROMPT" >&2
    exit 127
    ;;
  *)
    echo "Usage: copilot.sh {install|run <prompt>}" >&2
    exit 1
    ;;
esac
