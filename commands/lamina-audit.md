---
description: Audit existing flows and return prioritized UX improvements by impact and effort.
disable-model-invocation: true
---

# /lamina-audit

## Product

Audit one or more existing flows and return improvements ranked by impact vs effort.

## Load

- `skills/lamina-orchestrator/SKILL.md`
- `skills/lamina-orchestrator/workflows/audit.md`
- `skills/lamina-orchestrator/audit-profiles.yaml`
- `skills/lamina-orchestrator/artifacts.md`
- `skills/lamina-orchestrator/prerequisites/init-required.md`
- Output contract: `skills/lamina-orchestrator/prompts/outputs/audit.md`
- Blocked output: `skills/lamina-orchestrator/prompts/outputs/init-blocked.md`

## Prerequisite

Requires valid `.lamina/business-context.md` from `/lamina-init`. If the init gate fails, stop and instruct the user to run init — do not proceed with audit.

## Guardrail

UX artifacts only. Do not implement product code or visual styling specs.

## Subagent hints

- **Parallel review:** `skills/lamina-orchestrator/agents/ux-lens-reviewer` across audit lenses (main win)
- **Persona panel:** dynamic spawns per flow when `personas.yaml` exists — see `skills/lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
- Default: inline if parallel unavailable
