#!/bin/bash
set -euo pipefail

export PYTHONPATH=/tests

python3 /tests/capture_artifact.py

uvx --with harbor-rewardkit@0.1 --with pyyaml rewardkit /tests

python3 /tests/finalize_reward.py
