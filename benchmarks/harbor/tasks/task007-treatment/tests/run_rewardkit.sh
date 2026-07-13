#!/bin/bash
# Retry rewardkit on transient gateway / LLM judge failures (502, 503, 504, 429).
# Always exits 0 so finalize_reward.py can apply golden-only fallback if needed.
set -uo pipefail

MAX_ATTEMPTS="${REWARDKIT_MAX_ATTEMPTS:-5}"
BASE_DELAY_SEC="${REWARDKIT_RETRY_DELAY_SEC:-5}"
REWARD_PATH="/logs/verifier/reward.json"
DETAILS_PATH="/logs/verifier/reward-details.json"
TRANSIENT_RE='502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout|429 Too Many|BadGatewayError|api_error.*[Rr]etry|did not return a response|connection (reset|refused|error)|timed out|Temporary failure|overloaded'

rewardkit_succeeded() {
  [[ -f "$REWARD_PATH" ]] || [[ -f "$DETAILS_PATH" ]]
}

run_once() {
  local attempt="$1"
  local log="/tmp/rewardkit-attempt-${attempt}.log"
  set +e
  uvx --from harbor-rewardkit==0.1.7 --with pyyaml rewardkit /tests 2>&1 | tee "$log"
  local status=${PIPESTATUS[0]}
  set -e
  echo "$status" > "/tmp/rewardkit-attempt-${attempt}.status"
  echo "$log"
}

attempt=1
while [[ "$attempt" -le "$MAX_ATTEMPTS" ]]; do
  log="$(run_once "$attempt")"
  status="$(cat "/tmp/rewardkit-attempt-${attempt}.status")"

  if [[ "$status" -eq 0 ]] && rewardkit_succeeded; then
    echo "rewardkit succeeded on attempt ${attempt}/${MAX_ATTEMPTS}"
    exit 0
  fi

  if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]] && grep -Eiq "$TRANSIENT_RE" "$log"; then
    delay=$((BASE_DELAY_SEC * attempt))
    echo "rewardkit transient failure on attempt ${attempt}/${MAX_ATTEMPTS} (exit ${status}); retrying in ${delay}s..." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    continue
  fi

  if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]] && ! rewardkit_succeeded; then
    delay=$((BASE_DELAY_SEC * attempt))
    echo "rewardkit produced no reward output on attempt ${attempt}/${MAX_ATTEMPTS}; retrying in ${delay}s..." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    continue
  fi

  echo "rewardkit exhausted retries (last exit ${status}); continuing with partial scoring" >&2
  exit 0
done

echo "rewardkit exhausted retries; continuing with partial scoring" >&2
exit 0
