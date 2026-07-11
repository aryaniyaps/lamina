# Lamina workflow (benchmark treatment arm)

When doing **product-related work** in this workspace, follow the Lamina agent-native design loop using slash commands and installed Lamina skills.

## Required workflow order

1. **`/lamina-init`** — establish or update business context under `.lamina/` only (no app source yet).
2. **`/lamina-design`** — for greenfield/feature/workflow tasks; **or `/lamina-verify`** first for audit/brownfield tasks.
3. **Implement** the full product scope from the design contract and task brief.
4. **`/lamina-verify`** — post-build verification; write findings under `.lamina/runs/<run_id>/`.
5. **Fix** product-behavior issues from `fix.md` in application source.

Use Lamina run layout: `.lamina/runs/<run_id>/` with `run.yaml`, `implement.md`, `report.md`, and `fix.md`. Do not use `.lamina/ready_to_build/` as a directory.

## Unattended benchmark

The user **cannot respond** to clarifying questions during this run.

- Treat `instruction.md` and fixture context as the user's answers.
- If a Lamina skill would normally clarify and STOP, **do not STOP** — document assumptions under **Open questions** and continue the workflow.
- Never emit a clarification-only response without also producing required deliverables.

## Scope

Build the **full product** described in the task brief — not a demo stub. Primary workflows, edge cases, and enough UI that the product is usable.
