---
name: lamina-init
description: "Establish or update business context — goals, scope, users, metrics — for UX work."
disable-model-invocation: true
---

# /lamina-init

## Product

Answer the business questions UX work depends on and persist them in `.lamina/business-context.md`. Establish mode also casts `.lamina/personas.yaml` from available evidence. Run once per project (or again when the business use case changes).

## Modes

- **establish** (default) — first-time bootstrap
- **update** — pivot, new market, scope change; merges into existing file and appends changelog

## Load

- `../lamina-orchestrator/SKILL.md`
- `../lamina-orchestrator/workflows/init.md`
- `../lamina-business-context/SKILL.md`
- `../lamina-orchestrator/artifacts.md`
- `../lamina-orchestrator/audit-profiles.yaml`
- Output contract: `../lamina-orchestrator/prompts/outputs/init.md`

## Guardrail

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor app source code, tests, config, styles, docs outside `.lamina/`, or generated source during `/lamina-init`. Brownfield scanning may read source files only to infer context. See [guardrails](../lamina-core/guardrails.md).

## Subagent hints

- **Fresh context:** `../lamina-orchestrator/agents/research-synthesizer` for large doc corpus on brownfield establish/update
- Default: inline sequential
