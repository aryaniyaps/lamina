#!/bin/bash
# Matched multi-phase trial harness (Design C — ecological loop).
# Both arms: 5 sequential claude --resume phases in ONE session, equal budgets.
# Treatment: harness sends /lamina-* as user slash-command messages (disable-model-invocation).
# During slash turns Mode B writes .lamina/ only; next user turn is ordinary implement/fix.
# Subagent spawning (Agent/Task) is allowed — required for Lamina verify walks.
# Any phase failure (non-zero exit or max-turns) fails the trial.
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

# Factual: no mid-turn user. Do not override Lamina clarify-and-STOP — stalls score 0.
UNATTENDED="This is an unattended trial — the user cannot respond mid-turn.
Treat the task brief below and workspace artifacts as authoritative."

PRODUCT_GUARD="Deliverable scope:
- Build the end-user **product application** described in the task brief.
- Do **not** build a trial runner, evaluation harness, test framework, CLI for running trials, or any meta-tool about agent evaluation.
- Your job is the product in the brief."

# Keep plans scorable (product behavior) without expanding into ops that trigger implement refusals.
PLAN_SCOPE="Plan for **product behavior** only: domain model, actors/permissions, primary workflows, edge cases, and UI/API surfaces.
Do **not** make CI/CD, app-store packaging, production deployment, push-notification infrastructure, or observability required deliverables."

# Explicit handoff: prior phases may say "docs only" — this turn overrides that.
# Framing avoids "production-ready everything in one turn" refusals while keeping real-code expectations.
IMPLEMENT_HANDOFF="This turn is implementation — not planning.
- Earlier turns may have said not to write application source / to write plans or contracts only. Those restrictions ended. They do not apply now.
- Write real application source files in the workspace now. Markdown plans/contracts alone do not count.
- Goal: a **working product codebase** that expresses the brief's domain and primary workflows in code — not a launch-ready production system.
- Out of scope for this turn (skip without blocking): CI/CD, app-store packaging, production deploy, push infra, perfect test coverage, multi-native mobile shells.
- Prefer one pragmatic stack you can finish in-session (TypeScript/Node + simple web UI is fine even if the brief says mobile-first — make the UI mobile-friendly).
- Do not refuse for scope. Do not ask which slice to start. Start coding immediately and keep writing files."

IMPLEMENT_BODY="${IMPLEMENT_HANDOFF}

Requirements for this turn:
- Implement the domain model and primary workflows from the plan/brief in application source.
- Realize main user journeys end-to-end with real UI or API behavior — not types-only, stubs, or placeholder screens.
- Cover important edge/recovery paths from the brief where they affect product behavior.
- Keep going until product behaviors are represented in source. Partial real code beats a refusal or a remaining-task list.
- Do not wait for the user. Do not emit a remaining-task list and stop.

${PRODUCT_GUARD}

${UNATTENDED}"

FIX_BODY="${IMPLEMENT_HANDOFF}

Apply critical/high product-behavior fixes in application source this turn.
Skip ops/CI items. Do not stop after partial scaffolding or claim files exist that were not written.

${PRODUCT_GUARD}

${UNATTENDED}"

BRIEF="$(cat /tmp/lamina-bench-instruction.md)"

BRIEF_BLOCK="## Task brief (authoritative)

${BRIEF}"

run_control_design() {
  run_phase "control-plan" "Phase 1 — product plan (this phase only). Write a product plan and acceptance criteria in \`product-plan.md\` at the workspace root. Defer application source to a later phase.

${BRIEF_BLOCK}

${PRODUCT_GUARD}

${PLAN_SCOPE}

Cover domain model, actors, permissions, primary workflows, edge cases, and success criteria for the product in the brief.

${UNATTENDED}"

  run_phase "control-build-order" "Phase 2 — build order (this phase only). Expand \`product-plan.md\` into a build order focused on product source milestones in \`product-build-order.md\` at the workspace root. Defer application source to the next phase.

${BRIEF_BLOCK}

${PLAN_SCOPE}

Order work so an implementer can code domain + primary workflows first. Stay aligned with the product in the task brief.

${UNATTENDED}"

  run_phase "control-implement" "Phase 3 — implement the product now. Write application source following \`product-plan.md\` and \`product-build-order.md\`. Planning is done; code the product behaviors.

${BRIEF_BLOCK}

Authoritative inputs — use all:
1. \`product-plan.md\` — product plan and acceptance criteria.
2. \`product-build-order.md\` — build order and requirements.
3. The task brief above.

${IMPLEMENT_BODY}"

  run_phase "control-review" "Phase 4 — self-review (this phase only). Review the implementation against \`product-plan.md\`, \`product-build-order.md\`, and the task brief. Defer code edits to the next phase.

${BRIEF_BLOCK}

Write \`product-review.md\` (findings) and \`product-fix-list.md\` (prioritized **product-behavior** fixes) at the workspace root. Prefer fixes to domain/workflows/UI over ops/CI.

${UNATTENDED}"

  run_phase "control-fix" "Phase 5 — implement product fixes now. Apply prioritized product-behavior fixes from \`product-fix-list.md\` to application source.

${BRIEF_BLOCK}

Re-read \`product-plan.md\` and \`product-build-order.md\` if needed so fixes satisfy the plan and brief.

${FIX_BODY}"
}

run_control_audit() {
  run_phase "control-audit-scope" "Phase 1 — audit scope (this phase only). Write an audit scope and success criteria in \`product-plan.md\` at the workspace root. Defer application source edits to a later phase.

${BRIEF_BLOCK}

${PRODUCT_GUARD}

Cover invariants, permissions, workflows, error recovery, and prioritized fix areas for the product in the brief.

${UNATTENDED}"

  run_phase "control-audit-checklist" "Phase 2 — audit checklist (this phase only). Expand \`product-plan.md\` into an audit checklist and prioritized **product-behavior** fix plan in \`product-build-order.md\` at the workspace root. Defer application source edits to the next phase.

${BRIEF_BLOCK}

${PLAN_SCOPE}

${UNATTENDED}"

  run_phase "control-implement" "Phase 3 — implement product-behavior fixes now. Apply fixes from \`product-build-order.md\` and the task brief to application source.

${BRIEF_BLOCK}

${IMPLEMENT_BODY}"

  run_phase "control-review" "Phase 4 — self-review (this phase only). Review the updated implementation against \`product-plan.md\`, \`product-build-order.md\`, and the task brief. Defer code edits to the next phase.

${BRIEF_BLOCK}

Write \`product-review.md\` and \`product-fix-list.md\` (prioritized product-behavior fixes) at the workspace root.

${UNATTENDED}"

  run_phase "control-fix" "Phase 5 — implement product fixes now. Apply prioritized product-behavior fixes from \`product-fix-list.md\` to application source.

${BRIEF_BLOCK}

Re-read \`product-plan.md\` and \`product-build-order.md\` if needed.

${FIX_BODY}"
}

# Slash turns: first line is the slash command (Claude Code expands it). Body is user args + brief.
run_treatment_design() {
  run_phase "treatment-init" "/lamina-init

${BRIEF}

${PRODUCT_GUARD}

${UNATTENDED}"

  run_phase "treatment-design" "/lamina-design

${BRIEF_BLOCK}

${PRODUCT_GUARD}

${PLAN_SCOPE}

${UNATTENDED}"

  run_phase "treatment-implement" "Phase 3 — implement the product now following the Lamina ship pack. Contracts are inputs; write a working product codebase outside \`.lamina/\`.

${BRIEF_BLOCK}

Use \`.lamina/runs/*/run.yaml\` and the matching \`implement.md\` in that same run directory as the build contract. If no \`.lamina/runs/*/run.yaml\` exists, stop and report that design did not produce a canonical contract — do **not** invent a replacement plan file. If the contract lists CI/deploy/push infra, skip those and implement product behavior first.

${IMPLEMENT_BODY}"

  run_phase "treatment-verify" "/lamina-verify

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-fix" "Phase 5 — implement product fixes now following \`.lamina/runs/*/fix.md\`. Apply prioritized product-behavior fixes to application source outside \`.lamina/\`.

${BRIEF_BLOCK}

If \`fix.md\` is missing under \`.lamina/runs/\`, stop and report that verify did not emit a canonical fix brief — do not invent findings. Re-read \`run.yaml\` and \`implement.md\` if needed. Skip ops/CI findings.

${FIX_BODY}"
}

run_treatment_audit() {
  run_phase "treatment-init" "/lamina-init

${BRIEF}

${PRODUCT_GUARD}

${UNATTENDED}"

  run_phase "treatment-verify-1" "/lamina-verify

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-implement" "Phase 3 — implement product fixes now following \`.lamina/runs/*/fix.md\`. Write application source — not more planning markdown alone.

${BRIEF_BLOCK}

Apply prioritized product-behavior fixes from \`.lamina/runs/*/fix.md\` to application source (outside \`.lamina/\`). If missing, stop and report verify did not emit a canonical fix brief. Use the task brief and audit findings as authoritative. Skip ops/CI items.

${IMPLEMENT_BODY}"

  run_phase "treatment-verify-2" "/lamina-verify

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "treatment-fix" "Phase 5 — implement remaining product fixes now following \`.lamina/runs/*/fix.md\`. Apply them to application source outside \`.lamina/\`.

${BRIEF_BLOCK}

If \`fix.md\` is missing under \`.lamina/runs/\`, stop and report — do not invent findings. Skip ops/CI findings. Prefer domain/workflow/UI fixes.

${FIX_BODY}"
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
