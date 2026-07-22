#!/usr/bin/env bash
# Ensure local LiteLLM Anthropic→OpenAI proxy is listening on :4000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${LAMINA_CLAUDE_PROXY_PORT:-4000}"
CFG="$ROOT/evals/tmp/litellm-claude-proxy.yaml"
LOG="$ROOT/evals/tmp/litellm-proxy.log"
KEY="${LITELLM_MASTER_KEY:-sk-lamina-eval-local}"

if curl -sf "http://127.0.0.1:${PORT}/v1/models" -H "Authorization: Bearer ${KEY}" >/dev/null 2>&1; then
  exit 0
fi

if [[ ! -f "$CFG" ]]; then
  echo "missing $CFG" >&2
  exit 0
fi

mkdir -p "$ROOT/evals/tmp"
if [[ -x "$ROOT/.venv-eval/bin/litellm" ]]; then
  LITELLM="$ROOT/.venv-eval/bin/litellm"
elif command -v litellm >/dev/null 2>&1; then
  LITELLM="$(command -v litellm)"
else
  echo "litellm not installed; skip proxy" >&2
  exit 0
fi

nohup env LITELLM_MASTER_KEY="$KEY" "$LITELLM" --config "$CFG" --port "$PORT" >>"$LOG" 2>&1 &
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:${PORT}/v1/models" -H "Authorization: Bearer ${KEY}" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.5
done
exit 0
