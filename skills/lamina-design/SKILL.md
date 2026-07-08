---
name: lamina-design
description: "Design net-new UX — from problem framing through flows, edge cases, validation, and handoff."
disable-model-invocation: true
---

# /lamina-design

## Product

Design net-new UX — from a user problem, product idea, or named capability through flows, edge cases, validation, and handoff.

## Load

- `../lamina-orchestrator/SKILL.md`
- `../lamina-orchestrator/workflows/design.md`
- `../lamina-orchestrator/audit-profiles.yaml`
- `../lamina-orchestrator/artifacts.md`
- `../lamina-orchestrator/prerequisites/init-required.md`
- Output contract: `../lamina-orchestrator/prompts/outputs/design.md`
- Blocked output: `../lamina-orchestrator/prompts/outputs/init-blocked.md`

## Prerequisite

Requires valid `.lamina/business-context.md` from `/lamina-init`. If the init gate fails, emit the `init-blocked` contract **verbatim** from `../lamina-orchestrator/prompts/outputs/init-blocked.md` and **STOP** — do not proceed with design, do not create artifacts.

## Guardrail

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor app source code, tests, config, styles, docs outside `.lamina/`, or generated source during `/lamina-design`. A completed checklist, handoff, or approved blueprint is input for a later coding session, not permission to modify source now. If the user asks to implement, refuse that part briefly and finish only `.lamina/` artifacts. See [guardrails](../lamina-core/guardrails.md).

## Routing

Use the single design workflow for net-new UX. If the request is to redesign, improve, fix, or optimize shipped UI, route to `/lamina-audit` instead.

## Subagent hints

- **Fresh context:** `../lamina-orchestrator/agents/research-synthesizer` for large research docs or brownfield source sets
- **Persona panel:** dynamic spawns after flows/screens or journey exists; see `../lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
- **Parallel review:** `../lamina-orchestrator/agents/ux-lens-reviewer` for accessibility + risks
- Default: inline sequential
