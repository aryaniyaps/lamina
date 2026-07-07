---
description: Start from a user problem and build a complete UX concept incrementally.
disable-model-invocation: true
---

# /lamina-ideate

## Product

Start from a user problem and build a complete UX concept incrementally — one layer at a time.

## Load

- `skills/lamina-orchestrator/SKILL.md`
- `skills/lamina-orchestrator/workflows/ideate.md`
- `skills/lamina-orchestrator/audit-profiles.yaml`
- `skills/lamina-orchestrator/artifacts.md`
- Output contract: `skills/lamina-orchestrator/prompts/outputs/ideate.md`

## Guardrail

UX artifacts only. Do not implement product code or visual styling specs.

## Subagent hints

- **Fresh context:** `skills/lamina-orchestrator/agents/research-synthesizer` for large research docs (step 1)
- **Persona panel:** dynamic spawns at step 4 — one subagent per persona; see `skills/lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
- Default: inline sequential
