---
description: Turn a feature idea into a UX spec with risks, accessibility, metrics, and checklist.
disable-model-invocation: true
---

# /lamina-feature

## Product

Turn a feature idea into an implementation-ready UX spec with risks, accessibility, and success criteria.

## Load

- `skills/lamina-orchestrator/SKILL.md`
- `skills/lamina-orchestrator/workflows/feature.md`
- `skills/lamina-orchestrator/audit-profiles.yaml`
- `skills/lamina-orchestrator/artifacts.md`
- Output contract: `prompts/outputs/feature.md`

## Guardrail

UX artifacts only. Do not implement product code or visual styling specs.

## Subagent hints

- **Persona panel:** dynamic spawns after flows — one subagent per persona; see `prompts/subagents/persona-panel-spawn.md`
- **Parallel review:** `agents/ux-lens-reviewer` for accessibility + risks
- Default: inline sequential
