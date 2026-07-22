#!/usr/bin/env bash
# agent-skill-eval pre-run hook: stage fixture (if any) then install skills in sandbox.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Drop stale ASE workspaces so inotify watches and disk do not accumulate across runs.
# Never delete the current ASE_WORKSPACE_PATH (with_skill can still be active when
# without_skill pre-run fires, or a sibling agent workspace must stay intact).
# Only remove directories older than 60 minutes.
if [[ -d "$ROOT/eval-workspace" ]]; then
  CURRENT="${ASE_WORKSPACE_PATH:-}"
  shopt -s nullglob
  for d in "$ROOT/eval-workspace"/agent-skill-eval-*; do
    [[ -d "$d" ]] || continue
    if [[ -n "$CURRENT" && "$d" -ef "$CURRENT" ]]; then
      continue
    fi
    # mmin +60 => last modified more than 60 minutes ago
    if find "$d" -maxdepth 0 -type d -mmin +60 | grep -q .; then
      rm -rf "$d" 2>/dev/null || true
    fi
  done
  shopt -u nullglob
fi

bash "$ROOT/evals/hooks/stage-eval-fixture.sh"
bash "$ROOT/evals/hooks/install-skill.sh"
