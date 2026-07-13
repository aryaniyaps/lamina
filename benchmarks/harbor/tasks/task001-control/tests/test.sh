#!/bin/bash
set -euo pipefail

export PYTHONPATH=/tests

python3 /tests/capture_artifact.py

bash /tests/run_rewardkit.sh

python3 /tests/finalize_reward.py
