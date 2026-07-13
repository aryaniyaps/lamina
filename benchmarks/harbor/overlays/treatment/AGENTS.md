# Lamina workflow (benchmark treatment arm)

When doing **product-related work** in this workspace, follow the Lamina agent-native design loop using **slash commands** and installed Lamina skills.

**Important:** In this benchmark workspace, invoke `lamina-init`, `lamina-design`, and `lamina-verify` via **slash commands** (`/lamina-init`, etc.) or the **Skill tool** — in that order before implementing application source.

## Command boundary (Mode B — do not change)

Lamina slash commands (`/lamina-init`, `/lamina-design`, `/lamina-verify`) write **under `.lamina/` only**. They produce contracts (`run.yaml`, `implement.md`, `fix.md`) — they never edit application source. That is correct.

## Required workflow order

1. **`/lamina-init`** — business context under `.lamina/` only.
2. **`/lamina-design`** — for greenfield/feature/workflow tasks; **or `/lamina-verify`** first for audit/brownfield tasks. Ends at `ready_to_build` + `implement.md` (no app source).
3. **Implement (host coding agent — not a Lamina command)** — write application source outside `.lamina/` from:
   - `.lamina/runs/<run_id>/run.yaml` (machine contract: entities, invariants, workflows, scenarios, screens)
   - `.lamina/runs/<run_id>/implement.md` (build order + acceptance brief)
   - the task brief
4. **`/lamina-verify`** — post-build verification; write `report.md` + `fix.md` under `.lamina/` only.
5. **Fix (host coding agent — not a Lamina command)** — apply product fixes from `fix.md` in application source.

Use Lamina run layout: `.lamina/runs/<run_id>/` with `run.yaml`, `implement.md`, `report.md`, and `fix.md`. Do not use `.lamina/ready_to_build/` as a directory.

## Unattended trial

The user **cannot respond** during this run.

- Treat `instruction.md` and fixture context as authoritative.
- Build the **product in the brief** — never a benchmark runner, evaluation harness, or meta-tool about trials.
- During Lamina commands: if a skill would clarify-and-STOP, document assumptions under **Open questions** and continue the Lamina command to completion.
- During **implement** and **fix** (host coding phases): do **not** wait for the user to say proceed. Do **not** end with a task list or roadmap. Finish the full product from `run.yaml` + `implement.md` (then from `fix.md`) in this session.
- Never emit a clarification-only or plan-only response without also producing the required deliverables for that phase.

## Scope

Build the **full product** described by the Lamina contract and task brief — not a demo stub or scaffold. Primary workflows, edge cases, and enough UI that the product is usable.
