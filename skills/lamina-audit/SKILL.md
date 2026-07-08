---
name: lamina-audit
description: "Audit existing flows and return prioritized UX improvements by impact and effort."
disable-model-invocation: true
---

# /lamina-audit

## Product

Audit one or more existing flows and return improvements ranked by impact vs effort.

## Load

- `../lamina-orchestrator/SKILL.md`
- `../lamina-orchestrator/workflows/audit.md`
- `../lamina-orchestrator/audit-profiles.yaml`
- `../lamina-orchestrator/artifacts.md`
- `../lamina-orchestrator/prerequisites/init-required.md`
- Output contract: `../lamina-orchestrator/prompts/outputs/audit.md`
- Blocked output: `../lamina-orchestrator/prompts/outputs/init-blocked.md`

## Prerequisite

Requires valid `.lamina/business-context.md` from `/lamina-init`. If the init gate fails, emit the `init-blocked` contract **verbatim** from `../lamina-orchestrator/prompts/outputs/init-blocked.md` and **STOP** — do not proceed with audit, do not create artifacts.

## Guardrail

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor app source code, tests, config, styles, docs outside `.lamina/`, or generated source during `/lamina-audit`. Audit findings and handoff docs are input for a later coding session, not permission to fix source now. If the user asks to fix code, refuse that part briefly and finish only `.lamina/` artifacts. See [guardrails](../lamina-core/guardrails.md).

## Subagent hints

- **Parallel review:** `../lamina-orchestrator/agents/ux-lens-reviewer` across audit lenses (main win)
- **Persona panel:** dynamic spawns per flow when `personas.yaml` exists — see `../lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
- Default: inline if parallel unavailable
