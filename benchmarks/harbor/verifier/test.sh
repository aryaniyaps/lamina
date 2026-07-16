#!/bin/bash
set -euo pipefail

export PYTHONPATH=/tests

python3 /tests/capture_artifact.py

if [[ "${LAMINA_BENCH_QUALITY_PRECOMPUTED:-0}" != "1" ]]; then
  python3 /tests/quality_checks.py
fi

bash /tests/run_rewardkit.sh

python3 /tests/finalize_reward.py
