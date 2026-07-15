#!/bin/bash
# Produce Rewardkit-compatible reward files with Codex authenticated by the
# user's ChatGPT subscription. No OpenAI API key is used.
set -uo pipefail

MAX_ATTEMPTS="${JUDGE_MAX_ATTEMPTS:-2}"
BASE_DELAY_SEC="${JUDGE_RETRY_DELAY_SEC:-2}"

mkdir -p "${CODEX_HOME:-/logs/verifier/codex-home}"
cp /tmp/codex-auth.json "${CODEX_HOME:-/logs/verifier/codex-home}/auth.json"
chmod 600 "${CODEX_HOME:-/logs/verifier/codex-home}/auth.json"
trap 'rm -f "${CODEX_HOME:-/logs/verifier/codex-home}/auth.json"' EXIT

for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt++)); do
  if python3 /tests/subscription_judge.py; then
    echo "Codex subscription judge succeeded on attempt ${attempt}/${MAX_ATTEMPTS}"
    exit 0
  fi
  if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
    delay=$((BASE_DELAY_SEC * attempt))
    echo "Codex subscription judge failed on attempt ${attempt}/${MAX_ATTEMPTS}; retrying in ${delay}s" >&2
    sleep "$delay"
  fi
done

echo "Codex subscription judge exhausted retries; finalizer will mark scoring incomplete" >&2
exit 0
