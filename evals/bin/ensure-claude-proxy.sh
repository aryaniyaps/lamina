#!/usr/bin/env bash
# Ensure local LiteLLM Anthropic→OpenAI proxy is listening on :4000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${LAMINA_CLAUDE_PROXY_PORT:-4000}"
CFG="$ROOT/evals/tmp/litellm-claude-proxy.yaml"
LOG="$ROOT/evals/tmp/litellm-proxy.log"
KEY="${LITELLM_MASTER_KEY:-sk-lamina-eval-local}"
MODEL="${LAMINA_EVAL_CLAUDE_MODEL:-gpt-4o-mini}"

if curl -sf "http://127.0.0.1:${PORT}/v1/models" -H "Authorization: Bearer ${KEY}" >/dev/null 2>&1; then
  exit 0
fi

mkdir -p "$ROOT/evals/tmp"
if [[ -x "$ROOT/.venv-eval/bin/litellm" ]]; then
  LITELLM="$ROOT/.venv-eval/bin/litellm"
elif command -v litellm >/dev/null 2>&1; then
  LITELLM="$(command -v litellm)"
else
  echo "litellm not installed; cannot run Claude through OpenAI" >&2
  exit 1
fi

if [[ -f "$CFG" ]]; then
  PROXY_ARGS=(--config "$CFG")
else
  case "$MODEL" in
    */*) BACKEND_MODEL="$MODEL" ;;
    *) BACKEND_MODEL="openai/$MODEL" ;;
  esac
  # Keep paid evals reproducible without relying on an ignored, workstation-only
  # YAML file. The alias is the model name Claude Code sends to /v1/messages.
  PROXY_ARGS=(--model "$BACKEND_MODEL" --alias "$MODEL" --drop_params)
fi

: >"$LOG"
nohup env LITELLM_MASTER_KEY="$KEY" "$LITELLM" "${PROXY_ARGS[@]}" --port "$PORT" >>"$LOG" 2>&1 &
for _ in {1..60}; do
  if curl -sf "http://127.0.0.1:${PORT}/v1/models" -H "Authorization: Bearer ${KEY}" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.5
done
echo "Claude eval proxy failed to become ready on port $PORT" >&2
tail -20 "$LOG" >&2 || true
exit 1
