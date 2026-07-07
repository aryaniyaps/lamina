---
name: lamina-init
description: "Establish or update business context — goals, scope, users, metrics — for UX work."
disable-model-invocation: true
---

# /lamina-init

## Product

Answer the business questions UX work depends on and persist them in `.lamina/business-context.md`. Run once per project (or again when the business use case changes).

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

UX artifacts only. Do not implement product code or visual styling specs.

## Subagent hints

- **Fresh context:** `../lamina-orchestrator/agents/research-synthesizer` for large doc corpus on brownfield establish/update
- Default: inline sequential
