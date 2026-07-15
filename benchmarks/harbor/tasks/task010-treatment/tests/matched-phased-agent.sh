#!/bin/bash
# Matched multi-phase trial harness (Design C — ecological loop).
# Both arms: 5 sequential codex exec/resume phases in ONE session, equal budgets.
# Treatment: harness explicitly invokes installed Lamina skills with Codex's $skill syntax.
# During slash turns Mode B writes .lamina/ only; next user turn implements/fixes from artifacts.
# Subagent spawning (Agent/Task) is allowed — required for Lamina verify walks.
# Any phase failure (non-zero exit or max-turns) fails the trial.
# Harness does not coach product strategy — only phase role, artifact paths, and the task brief.
# LAMINA_BENCH_ARM=control|treatment  LAMINA_BENCH_WORKFLOW=design|audit
set -uo pipefail

export PATH="$HOME/.local/bin:${PATH}"
mkdir -p /logs/agent
mkdir -p "${HOME:-/root}"
mkdir -p "${CODEX_HOME:-/logs/agent/codex-home}"
cp /tmp/codex-auth.json "${CODEX_HOME:-/logs/agent/codex-home}/auth.json"
chmod 600 "${CODEX_HOME:-/logs/agent/codex-home}/auth.json"
trap 'rm -f "${CODEX_HOME:-/logs/agent/codex-home}/auth.json"' EXIT
LOG=/logs/agent/codex.txt
: >"$LOG"

ARM="${LAMINA_BENCH_ARM:-treatment}"
WORKFLOW="${LAMINA_BENCH_WORKFLOW:-design}"

CODEX_FLAGS=(
  --dangerously-bypass-approvals-and-sandbox
  --skip-git-repo-check
  --model
  "${CODEX_MODEL:-gpt-5.6-sol}"
  --json
  -c
  model_reasoning_effort=high
)

SESSION_ID=""
PHASE_FAILURES=0

# Extract the Codex thread id from JSONL output.
thread_id_from_jsonl() {
  local file="$1"
  python3 - "$file" <<'PY'
import json, sys
path = sys.argv[1]
thread_id = None
with open(path, "r", errors="replace") as f:
    for line in f:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        if obj.get("type") == "thread.started":
            thread_id = obj.get("thread_id")
        elif obj.get("thread_id"):
            thread_id = obj.get("thread_id")
if not thread_id:
    sys.exit(1)
print(thread_id)
PY
}

run_phase() {
  local label="$1"
  local prompt="$2"
  local tmp
  tmp=$(mktemp)

  echo "[matched-phased] phase=${label} session=${SESSION_ID:-new}" | tee -a "$LOG"

  local status=0
  if [ -z "$SESSION_ID" ]; then
    codex exec "${CODEX_FLAGS[@]}" -- "$prompt" >"$tmp" 2>&1 </dev/null || status=$?
  else
    codex exec resume "$SESSION_ID" "${CODEX_FLAGS[@]}" -- "$prompt" >"$tmp" 2>&1 </dev/null || status=$?
  fi
  cat "$tmp" | tee -a "$LOG" >/dev/null
  local sid=""
  if sid=$(thread_id_from_jsonl "$tmp"); then
    if [ -n "$sid" ]; then
      if [ -n "$SESSION_ID" ] && [ "$sid" != "$SESSION_ID" ]; then
        PHASE_FAILURES=$((PHASE_FAILURES + 1))
        echo "ERROR: phase ${label} resumed thread ${SESSION_ID} but output thread_id=${sid} (resume broken)" | tee -a "$LOG"
      fi
      SESSION_ID="$sid"
    fi
  else
    PHASE_FAILURES=$((PHASE_FAILURES + 1))
    echo "ERROR: phase ${label} produced no parseable Codex thread_id" | tee -a "$LOG"
  fi
  rm -f "$tmp"

  if [ -z "$SESSION_ID" ]; then
    PHASE_FAILURES=$((PHASE_FAILURES + 1))
    echo "ERROR: phase ${label} left SESSION_ID empty — cannot continue same-session trial" | tee -a "$LOG"
  fi

  if [ "$status" -ne 0 ]; then
    PHASE_FAILURES=$((PHASE_FAILURES + 1))
    echo "ERROR: phase ${label} exited ${status}" | tee -a "$LOG"
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

# Codex skill turns: $skill-name explicitly loads the installed workflow skill.
run_treatment_design() {
  run_phase "treatment-init" "\$lamina-init

${BRIEF}

${UNATTENDED}"

  run_phase "treatment-design" "\$lamina-design

Phase 2 — Complete the Lamina design workflow and its canonical implementation contract. Defer application source to the next phase.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-implement" "Phase 3 — Implement the canonical \`.lamina/runs/*/implement.md\` contract end to end in application source.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-verify" "\$lamina-verify

Phase 4 — Verify the implementation and produce the canonical report and fix artifacts. Defer application source edits to the next phase.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-fix" "Phase 5 — Implement the canonical \`.lamina/runs/*/fix.md\` end to end in application source.

${BRIEF_BLOCK}

${UNATTENDED}"
}

run_treatment_audit() {
  run_phase "treatment-init" "\$lamina-init

${BRIEF}

${UNATTENDED}"

  run_phase "treatment-verify-1" "\$lamina-verify

Phase 2 — Verify the current implementation and produce the canonical report and fix artifacts. Defer application source edits to the next phase.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-implement" "Phase 3 — Implement the canonical \`.lamina/runs/*/fix.md\` end to end in application source.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-verify-2" "\$lamina-verify

Phase 4 — Re-verify the implementation and refresh the canonical report and fix artifacts. Defer application source edits to the next phase.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-fix" "Phase 5 — Implement the canonical \`.lamina/runs/*/fix.md\` end to end in application source.

${BRIEF_BLOCK}

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
