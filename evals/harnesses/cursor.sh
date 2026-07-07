#!/usr/bin/env bash
# Tier 2 harness adapter for Cursor.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACTION="${1:-install}"

# shellcheck source=../hooks/skills-sandbox.sh
source "$ROOT/evals/hooks/skills-sandbox.sh"

case "$ACTION" in
  install)
    skills_add -a cursor -y
    ;;
  run)
    PROMPT="${2:?prompt required}"
    if command -v cursor-agent >/dev/null 2>&1; then
      cursor-agent -p "$PROMPT"
    elif command -v cursor >/dev/null 2>&1; then
      cursor --prompt "$PROMPT"
    else
      echo "Cursor CLI not found; install Cursor and enable agent CLI" >&2
      exit 127
    fi
    ;;
  *)
    echo "Usage: cursor.sh {install|run <prompt>}" >&2
    exit 1
    ;;
esac
