#!/usr/bin/env bash
# Tier 2 harness adapter for Gemini CLI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACTION="${1:-install}"

# shellcheck source=../hooks/skills-sandbox.sh
source "$ROOT/evals/hooks/skills-sandbox.sh"

case "$ACTION" in
  install)
    skills_add -a gemini-cli -y
    ;;
  run)
    PROMPT="${2:?prompt required}"
    if command -v gemini >/dev/null 2>&1; then
      gemini -p "$PROMPT"
    else
      echo "gemini CLI not found" >&2
      exit 127
    fi
    ;;
  *)
    echo "Usage: gemini-cli.sh {install|run <prompt>}" >&2
    exit 1
    ;;
esac
