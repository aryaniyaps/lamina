#!/bin/bash
# Matched multi-phase trial harness (Design C — ecological loop).
# Both arms: 5 sequential claude --resume phases in ONE session, equal budgets.
# Treatment: harness sends /lamina-* as user slash-command messages (disable-model-invocation).
# During slash turns Mode B writes .lamina/ only; next user turn implements/fixes from artifacts.
# Subagent spawning (Agent/Task) is allowed — required for Lamina verify walks.
# Any phase failure (non-zero exit or max-turns) fails the trial.
# Harness does not coach product strategy — only phase role, artifact paths, and the task brief.
# LAMINA_BENCH_ARM=control|treatment  LAMINA_BENCH_WORKFLOW=design|audit
set -uo pipefail

export PATH="$HOME/.local/bin:${PATH}"
mkdir -p /logs/agent
mkdir -p "${HOME:-/root}"
LOG=/logs/agent/claude-code.txt
: >"$LOG"

ARM="${LAMINA_BENCH_ARM:-treatment}"
WORKFLOW="${LAMINA_BENCH_WORKFLOW:-design}"
MAX_TURNS="${LAMINA_BENCH_MAX_TURNS_PER_PHASE:-80}"

# Wait for background subagents in print mode (Lamina persona walks / parallel review).
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS="${CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS:-600000}"

CLAUDE_FLAGS=(
  --dangerously-skip-permissions
  --permission-mode=bypassPermissions
  --tools
  default
  --allowedTools
  Agent,Task
  --output-format
  json
  --max-turns
  "$MAX_TURNS"
)

SESSION_ID=""
PHASE_FAILURES=0

# Extract last Claude --output-format json result object from mixed stdout/stderr.
last_result_json() {
  local file="$1"
  python3 - "$file" <<'PY'
import json, sys
path = sys.argv[1]
last = None
with open(path, "r", errors="replace") as f:
    for line in f:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and "session_id" in obj:
            last = obj
if last is None:
    sys.exit(1)
print(json.dumps(last))
PY
}

result_field() {
  local json="$1"
  local field="$2"
  python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get(sys.argv[2],"") or "")' "$json" "$field"
}

result_is_true() {
  local json="$1"
  local field="$2"
  python3 -c 'import json,sys; v=json.loads(sys.argv[1]).get(sys.argv[2]); sys.exit(0 if v is True else 1)' "$json" "$field"
}

run_phase() {
  local label="$1"
  local prompt="$2"
  local tmp
  tmp=$(mktemp)

  echo "[matched-phased] phase=${label} session=${SESSION_ID:-new} max_turns=${MAX_TURNS}" | tee -a "$LOG"

  local status=0
  if [ -z "$SESSION_ID" ]; then
    claude "${CLAUDE_FLAGS[@]}" -p "$prompt" >"$tmp" 2>&1 || status=$?
  else
    claude "${CLAUDE_FLAGS[@]}" --resume "$SESSION_ID" -p "$prompt" >"$tmp" 2>&1 || status=$?
  fi
  cat "$tmp" | tee -a "$LOG" >/dev/null

  local result=""
  if result=$(last_result_json "$tmp"); then
    local sid
    sid=$(result_field "$result" session_id)
    if [ -n "$sid" ]; then
      if [ -n "$SESSION_ID" ] && [ "$sid" != "$SESSION_ID" ]; then
        PHASE_FAILURES=$((PHASE_FAILURES + 1))
        echo "ERROR: phase ${label} resumed session ${SESSION_ID} but result session_id=${sid} (resume broken)" | tee -a "$LOG"
      fi
      SESSION_ID="$sid"
    else
      PHASE_FAILURES=$((PHASE_FAILURES + 1))
      echo "ERROR: phase ${label} result missing session_id" | tee -a "$LOG"
    fi
  else
    PHASE_FAILURES=$((PHASE_FAILURES + 1))
    echo "ERROR: phase ${label} produced no parseable JSON result with session_id" | tee -a "$LOG"
    result=""
  fi
  rm -f "$tmp"

  if [ -z "$SESSION_ID" ]; then
    PHASE_FAILURES=$((PHASE_FAILURES + 1))
    echo "ERROR: phase ${label} left SESSION_ID empty — cannot continue same-session trial" | tee -a "$LOG"
  fi

  if [ "$status" -ne 0 ]; then
    PHASE_FAILURES=$((PHASE_FAILURES + 1))
    echo "ERROR: phase ${label} exited ${status}" | tee -a "$LOG"
    if [ -n "$result" ] && [ "$(result_field "$result" subtype)" = "error_max_turns" ]; then
      echo "ERROR: phase ${label} hit max turns (${MAX_TURNS})" | tee -a "$LOG"
    fi
  elif [ -n "$result" ] && result_is_true "$result" is_error; then
    PHASE_FAILURES=$((PHASE_FAILURES + 1))
    echo "ERROR: phase ${label} reported is_error=true subtype=$(result_field "$result" subtype)" | tee -a "$LOG"
  fi
}

# Factual trial constraint only — not product coaching.
UNATTENDED="This is an unattended trial — the user cannot respond mid-turn.
Treat the task brief below and workspace artifacts as authoritative."

BRIEF="$(cat /tmp/lamina-bench-instruction.md)"

BRIEF_BLOCK="## Task brief (authoritative)

${BRIEF}"

run_control_design() {
  run_phase "control-plan" "Phase 1 — Write a product plan and acceptance criteria in \`product-plan.md\` at the workspace root. Defer application source to a later phase.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "control-build-order" "Phase 2 — Expand \`product-plan.md\` into a build order in \`product-build-order.md\` at the workspace root. Defer application source to the next phase.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "control-implement" "Phase 3 — Implement \`product-plan.md\` and \`product-build-order.md\` end to end completely in application source.

${BRIEF_BLOCK}

Authoritative inputs:
1. \`product-plan.md\`
2. \`product-build-order.md\`
3. The task brief above.

${UNATTENDED}"

  run_phase "control-review" "Phase 4 — Review the implementation against \`product-plan.md\`, \`product-build-order.md\`, and the task brief. Write \`product-review.md\` and \`product-fix-list.md\` at the workspace root. Defer code edits to the next phase.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "control-fix" "Phase 5 — Implement \`product-fix-list.md\` end to end completely in application source.

${BRIEF_BLOCK}

${UNATTENDED}"
}

run_control_audit() {
  run_phase "control-audit-scope" "Phase 1 — Write an audit scope and success criteria in \`product-plan.md\` at the workspace root. Defer application source edits to a later phase.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "control-audit-checklist" "Phase 2 — Expand \`product-plan.md\` into an audit checklist and prioritized fix plan in \`product-build-order.md\` at the workspace root. Defer application source edits to the next phase.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "control-implement" "Phase 3 — Implement \`product-build-order.md\` end to end completely in application source.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "control-review" "Phase 4 — Review the updated implementation against \`product-plan.md\`, \`product-build-order.md\`, and the task brief. Write \`product-review.md\` and \`product-fix-list.md\` at the workspace root. Defer code edits to the next phase.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "control-fix" "Phase 5 — Implement \`product-fix-list.md\` end to end completely in application source.

${BRIEF_BLOCK}

${UNATTENDED}"
}

# Slash turns: first line is the slash command (Claude Code expands it). Body is user args + brief.
run_treatment_design() {
  run_phase "treatment-init" "/lamina-init

${BRIEF}

${UNATTENDED}"

  run_phase "treatment-design" "/lamina-design

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-implement" "Phase 3 — Implement \`.lamina/runs/*/run.yaml\` and the matching \`implement.md\` end to end completely in application source (outside \`.lamina/\`).

${BRIEF_BLOCK}

If no \`.lamina/runs/*/run.yaml\` exists, stop and report that design did not produce a canonical contract — do **not** invent a replacement plan file.

${UNATTENDED}"

  run_phase "treatment-verify" "/lamina-verify

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-fix" "Phase 5 — Implement \`.lamina/runs/*/fix.md\` end to end completely in application source (outside \`.lamina/\`).

${BRIEF_BLOCK}

If \`fix.md\` is missing under \`.lamina/runs/\`, stop and report that verify did not emit a canonical fix brief — do not invent findings.

${UNATTENDED}"
}

run_treatment_audit() {
  run_phase "treatment-init" "/lamina-init

${BRIEF}

${UNATTENDED}"

  run_phase "treatment-verify-1" "/lamina-verify

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-implement" "Phase 3 — Implement \`.lamina/runs/*/fix.md\` end to end completely in application source (outside \`.lamina/\`).

${BRIEF_BLOCK}

If \`fix.md\` is missing under \`.lamina/runs/\`, stop and report that verify did not emit a canonical fix brief — do not invent findings.

${UNATTENDED}"

  run_phase "treatment-verify-2" "/lamina-verify

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-fix" "Phase 5 — Implement \`.lamina/runs/*/fix.md\` end to end completely in application source (outside \`.lamina/\`).

${BRIEF_BLOCK}

If \`fix.md\` is missing under \`.lamina/runs/\`, stop and report — do not invent findings.

${UNATTENDED}"
}

case "${ARM}:${WORKFLOW}" in
  control:design) run_control_design ;;
  control:audit) run_control_audit ;;
  treatment:design) run_treatment_design ;;
  treatment:audit) run_treatment_audit ;;
  *)
    echo "ERROR: unsupported LAMINA_BENCH_ARM=${ARM} LAMINA_BENCH_WORKFLOW=${WORKFLOW}" >&2
    exit 1
    ;;
esac

if [ "$PHASE_FAILURES" -gt 0 ]; then
  echo "Matched phased agent FAILED arm=${ARM} workflow=${WORKFLOW} session=${SESSION_ID:-none} phase_failures=${PHASE_FAILURES}" >&2
  exit 1
fi

echo "Matched phased agent complete arm=${ARM} workflow=${WORKFLOW} session=${SESSION_ID:-none}"
exit 0
