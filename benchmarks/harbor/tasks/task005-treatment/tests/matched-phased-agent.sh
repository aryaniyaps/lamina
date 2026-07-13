#!/bin/bash
# Matched multi-phase trial harness (Design C — ecological loop).
# Both arms: 5 sequential claude --resume phases, equal structure and budgets.
# LAMINA_BENCH_ARM=control|treatment  LAMINA_BENCH_WORKFLOW=design|audit
set -euo pipefail

export PATH="$HOME/.local/bin:${PATH}"
mkdir -p /logs/agent
LOG=/logs/agent/claude-code.txt
: >"$LOG"

ARM="${LAMINA_BENCH_ARM:-treatment}"
WORKFLOW="${LAMINA_BENCH_WORKFLOW:-design}"
MAX_TURNS="${LAMINA_BENCH_MAX_TURNS_PER_PHASE:-40}"

CLAUDE_FLAGS=(
  --dangerously-skip-permissions
  --permission-mode=bypassPermissions
  --output-format
  json
  --max-turns
  "$MAX_TURNS"
)

SESSION_ID=""

run_phase() {
  local prompt="$1"
  local out
  if [ -z "$SESSION_ID" ]; then
    out=$(claude "${CLAUDE_FLAGS[@]}" -p "$prompt" 2>&1 | tee -a "$LOG" | tail -n 1)
  else
    out=$(claude "${CLAUDE_FLAGS[@]}" --resume "$SESSION_ID" -p "$prompt" 2>&1 | tee -a "$LOG" | tail -n 1)
  fi
  if echo "$out" | jq -e .session_id >/dev/null 2>&1; then
    SESSION_ID=$(echo "$out" | jq -r .session_id)
  fi
}

UNATTENDED="This is an unattended trial — the user cannot respond.
- Treat the task brief below and workspace artifacts as authoritative.
- Do not ask clarifying questions or wait for the user to say proceed.
- Do not end with a task list, roadmap, or \"next steps\" — finish the work in this phase.
- If information is missing, document assumptions and continue."

PRODUCT_GUARD="Deliverable scope:
- Build the end-user **product application** described in the task brief.
- Do **not** build a benchmark runner, evaluation harness, test framework, CLI for running trials, or any meta-tool about benchmarks or agent evaluation.
- The outer LaminaBench harness is separate; your job is the product in the brief."

BRIEF="$(cat /tmp/lamina-bench-instruction.md)"

BRIEF_BLOCK="## Task brief (authoritative)

${BRIEF}"

IMPLEMENT_BODY="Requirements for this phase:
- Complete every build-order step end-to-end.
- Realize every workflow, scenario, and screen the plan covers — not a scaffold or stub.
- Do not stop after types/slices/navigation alone. Write the real UI and domain behavior.
- Do not wait for the user. Do not emit a remaining-task list and stop.

${PRODUCT_GUARD}

${UNATTENDED}"

FIX_BODY="Finish all critical/high product findings in this phase — do not stop after partial scaffolding or claim files exist that were not written.

${PRODUCT_GUARD}

${UNATTENDED}"

run_control_design() {
  run_phase "Phase 1 — product plan. Write a complete product plan and acceptance criteria in \`product-plan.md\` at the workspace root (not application source).

${BRIEF_BLOCK}

${PRODUCT_GUARD}

Cover domain model, actors, permissions, primary workflows, edge cases, and success criteria for the product in the brief.

${UNATTENDED}"

  run_phase "Phase 2 — build order. Expand \`product-plan.md\` into a detailed build order and requirements document in \`product-build-order.md\` at the workspace root.

${BRIEF_BLOCK}

Do not write application source in this phase. Stay aligned with the product in the task brief.

${UNATTENDED}"

  run_phase "You are the coding agent. Implement the full product in application source.

${BRIEF_BLOCK}

Authoritative inputs — use all:
1. \`product-plan.md\` — product plan and acceptance criteria.
2. \`product-build-order.md\` — build order and requirements.
3. The task brief above.

${IMPLEMENT_BODY}"

  run_phase "Phase 4 — self-review. Review the implementation against \`product-plan.md\`, \`product-build-order.md\`, and the task brief.

${BRIEF_BLOCK}

Write \`product-review.md\` (findings) and \`product-fix-list.md\` (prioritized fixes) at the workspace root. Do not edit application source during this phase.

${UNATTENDED}"

  run_phase "You are the coding agent. Apply all prioritized product fixes from \`product-fix-list.md\` to application source.

${BRIEF_BLOCK}

Re-read \`product-plan.md\` and \`product-build-order.md\` if needed so fixes satisfy the plan and brief.

${FIX_BODY}"
}

run_control_audit() {
  run_phase "Phase 1 — audit scope. Write an audit scope and success criteria in \`product-plan.md\` at the workspace root.

${BRIEF_BLOCK}

${PRODUCT_GUARD}

Cover invariants, permissions, workflows, error recovery, and prioritized fix areas for the product in the brief.

${UNATTENDED}"

  run_phase "Phase 2 — audit checklist. Expand \`product-plan.md\` into a detailed audit checklist and prioritized fix plan in \`product-build-order.md\` at the workspace root.

${BRIEF_BLOCK}

Do not edit application source in this phase.

${UNATTENDED}"

  run_phase "You are the coding agent. Apply product-behavior fixes to application source per \`product-build-order.md\` and the task brief.

${BRIEF_BLOCK}

${IMPLEMENT_BODY}"

  run_phase "Phase 4 — self-review. Review the updated implementation against \`product-plan.md\`, \`product-build-order.md\`, and the task brief.

${BRIEF_BLOCK}

Write \`product-review.md\` and \`product-fix-list.md\` at the workspace root. Do not edit application source during this phase.

${UNATTENDED}"

  run_phase "You are the coding agent. Apply all prioritized fixes from \`product-fix-list.md\` to application source.

${BRIEF_BLOCK}

Re-read \`product-plan.md\` and \`product-build-order.md\` if needed.

${FIX_BODY}"
}

run_treatment_design() {
  run_phase "/lamina-init

${BRIEF}

${PRODUCT_GUARD}

${UNATTENDED}"

  run_phase "/lamina-design — complete the design contract (run.yaml) and implement.md for this task under .lamina/ only. Do not write application source.

${BRIEF_BLOCK}

${PRODUCT_GUARD}

${UNATTENDED}"

  run_phase "You are the coding agent (not a Lamina command). Implement the full product in application source outside .lamina/.

${BRIEF_BLOCK}

Authoritative inputs — use all:
1. The latest \`.lamina/runs/*/run.yaml\` — machine contract.
2. The matching \`implement.md\` — build order and acceptance brief.
3. The task brief above.

${IMPLEMENT_BODY}"

  run_phase "/lamina-verify — verify the implementation against the design contract. Write report.md and fix.md under .lamina/runs/<run_id>/ only. Do not edit application source during this command.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "You are the coding agent (not a Lamina command). Apply all prioritized product fixes from \`.lamina/runs/*/fix.md\` to application source (outside .lamina/).

${BRIEF_BLOCK}

Re-read \`run.yaml\` and \`implement.md\` if needed so fixes satisfy the contract and brief.

${FIX_BODY}"
}

run_treatment_audit() {
  run_phase "/lamina-init

${BRIEF}

${PRODUCT_GUARD}

${UNATTENDED}"

  run_phase "/lamina-verify — brownfield audit of the existing product. Write report.md and fix.md under .lamina/runs/<run_id>/ only. Do not edit application source during this command.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "You are the coding agent (not a Lamina command). Apply prioritized product fixes from \`.lamina/runs/*/fix.md\` to application source (outside .lamina/).

${BRIEF_BLOCK}

Use the task brief and audit findings as authoritative.

${IMPLEMENT_BODY}"

  run_phase "/lamina-verify — re-verify the implementation after fixes. Update report.md and fix.md under .lamina/runs/<run_id>/ only. Do not edit application source during this command.

${BRIEF_BLOCK}

${UNATTENDED}"

  run_phase "You are the coding agent (not a Lamina command). Apply all remaining prioritized fixes from \`.lamina/runs/*/fix.md\` to application source.

${BRIEF_BLOCK}

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

echo "Matched phased agent complete arm=${ARM} workflow=${WORKFLOW} session=${SESSION_ID:-none}"
