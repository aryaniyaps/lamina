#!/usr/bin/env bash
# agent-skill-eval pre-run hook: stage fixture (if any) then install skills in sandbox.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Drop stale ASE workspaces so inotify watches and disk do not accumulate across runs.
if [[ -d "$ROOT/eval-workspace" ]]; then
  find "$ROOT/eval-workspace" -maxdepth 1 -type d -name 'agent-skill-eval-*' -prune -exec rm -rf {} + 2>/dev/null || true
fi

bash "$ROOT/evals/hooks/stage-eval-fixture.sh"
bash "$ROOT/evals/hooks/install-skill.sh"
