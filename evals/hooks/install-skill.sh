#!/usr/bin/env bash
# Install the complete public Lamina skill set for eval harnesses.
# - With ASE_WORKSPACE_PATH: copy all skills into the agent workspace.
# - Otherwise: install every public skill into the sandbox.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENT="${ASE_AGENT:-claude-code}"

if [[ -n "${ASE_WORKSPACE_PATH:-}" && -d "${ASE_WORKSPACE_PATH}" ]]; then
  bash "$ROOT/evals/hooks/install-all-skills.sh"
  exit 0
fi

# shellcheck source=skills-sandbox.sh
source "$ROOT/evals/hooks/skills-sandbox.sh"

case "$AGENT" in
  cursor)
    skills_add -a cursor -y --skill '*'
    ;;
  gemini-cli)
    skills_add -a gemini-cli -y --skill '*'
    ;;
  github-copilot)
    skills_add -a github-copilot -y --skill '*'
    ;;
  roo-code|roo)
    skills_add -a roo -y --skill '*'
    ;;
  *)
    skills_add -a "$AGENT" -y --skill '*' 2>/dev/null || true
    ;;
esac

echo "Installed Lamina skills for agent: $AGENT (sandbox: $SANDBOX)"
