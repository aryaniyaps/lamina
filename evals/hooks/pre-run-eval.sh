#!/usr/bin/env bash
# agent-skill-eval pre-run hook: stage fixture (if any) then install skills in sandbox.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

bash "$ROOT/evals/hooks/stage-eval-fixture.sh"
bash "$ROOT/evals/hooks/install-skill.sh"
