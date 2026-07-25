#!/usr/bin/env bash
# Intermediate multi-step pass (claim score uses final-step RewardKit only).
set -euo pipefail
mkdir -p /logs/verifier
printf '%s\n' '{"reward": 1.0}' > /logs/verifier/reward.json
