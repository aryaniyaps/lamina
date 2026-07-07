#!/usr/bin/env bash
# agent-skill-eval pre-run hook: stage composite fixture when eval case sets fixture field.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKSPACE="${ASE_WORKSPACE_PATH:-$ROOT/evals/workspace/default}"
EVAL_ID="${ASE_EVAL_ID:-}"

if [[ -z "$EVAL_ID" ]]; then
  exit 0
fi

# Find eval case across suites (smoke + full merged)
for suite in "$ROOT/evals/smoke/evals.json" "$ROOT/evals/lamina/evals.json"; do
  [[ -f "$suite" ]] || continue
  FIXTURE="$(node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('$suite', 'utf8'));
    const ev = (data.evals || []).find(e => e.id === '$EVAL_ID');
    if (ev?.fixture) process.stdout.write(ev.fixture);
  ")"
  if [[ -n "$FIXTURE" ]]; then
    node "$ROOT/evals/scripts/stage-fixture.mjs" "$FIXTURE" --out "$WORKSPACE"
    echo "Staged fixture $FIXTURE into $WORKSPACE"
    exit 0
  fi
done
