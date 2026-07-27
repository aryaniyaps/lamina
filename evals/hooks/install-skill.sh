#!/usr/bin/env bash
# Install the complete single-skill Lamina bundle for eval harnesses.
# - With ASE_WORKSPACE_PATH: copy skills/lamina into the agent workspace.
# - Otherwise: install only the public `lamina` skill into the sandbox.
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
    skills_add -a cursor -y --skill lamina
    ;;
  gemini-cli)
    skills_add -a gemini-cli -y --skill lamina
    ;;
  github-copilot)
    skills_add -a github-copilot -y --skill lamina
    ;;
  roo-code|roo)
    skills_add -a roo -y --skill lamina
    ;;
  *)
    skills_add -a "$AGENT" -y --skill lamina 2>/dev/null || true
    ;;
esac

echo "Installed Lamina skills for agent: $AGENT (sandbox: $SANDBOX)"
