#!/bin/bash
set -euo pipefail
node /tests/harbor-score.mjs --workspace /app --golden /tests/golden.yaml --meta /tests/task-meta.json --out /logs/verifier/reward.json
