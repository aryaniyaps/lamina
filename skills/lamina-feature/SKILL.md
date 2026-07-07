---
name: lamina-feature
description: "Turn a feature idea into a UX spec with risks, accessibility, metrics, and checklist."
disable-model-invocation: true
---

# /lamina-feature

## Product

Turn a feature idea into an implementation-ready UX spec with risks, accessibility, and success criteria.

## Load

- `../lamina-orchestrator/SKILL.md`
- `../lamina-orchestrator/workflows/feature.md`
- `../lamina-orchestrator/audit-profiles.yaml`
- `../lamina-orchestrator/artifacts.md`
- Output contract: `../lamina-orchestrator/prompts/outputs/feature.md`

## Guardrail

UX artifacts only. Do not implement product code or visual styling specs.

## Subagent hints

- **Persona panel:** dynamic spawns after flows — one subagent per persona; see `../lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
- **Parallel review:** `../lamina-orchestrator/agents/ux-lens-reviewer` for accessibility + risks
- Default: inline sequential
