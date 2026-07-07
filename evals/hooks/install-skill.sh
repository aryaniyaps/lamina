#!/usr/bin/env bash
# agent-skill-eval pre-run hook: install Lamina skills for the target agent harness.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENT="${ASE_AGENT:-claude-code}"

# shellcheck source=skills-sandbox.sh
source "$ROOT/evals/hooks/skills-sandbox.sh"

case "$AGENT" in
  claude-code)
    skills_add -a claude-code -y 2>/dev/null || true
    ;;
  codex)
    skills_add -a codex -y 2>/dev/null || true
    ;;
  opencode)
    skills_add -a opencode -y 2>/dev/null || true
    ;;
  cursor)
    bash "$ROOT/evals/harnesses/cursor.sh" install
    ;;
  gemini-cli)
    bash "$ROOT/evals/harnesses/gemini-cli.sh" install
    ;;
  github-copilot)
    bash "$ROOT/evals/harnesses/copilot.sh" install
    ;;
  roo-code|roo)
    bash "$ROOT/evals/harnesses/roo-code.sh" install
    ;;
  *)
    skills_add -a "$AGENT" -y 2>/dev/null || true
    ;;
esac

echo "Installed Lamina skills for agent: $AGENT (sandbox: $SANDBOX)"
