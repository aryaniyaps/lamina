---
description: Establish or update business context — goals, scope, users, metrics — for UX work.
disable-model-invocation: true
---

# /lamina-init

## Product

Answer the business questions UX work depends on and persist them in `.lamina/business-context.md`. Run once per project (or again when the business use case changes).

## Modes

- **establish** (default) — first-time bootstrap
- **update** — pivot, new market, scope change; merges into existing file and appends changelog

## Load

- `skills/lamina-orchestrator/SKILL.md`
- `skills/lamina-orchestrator/workflows/init.md`
- `skills/lamina-business-context/SKILL.md`
- `skills/lamina-orchestrator/artifacts.md`
- `skills/lamina-orchestrator/audit-profiles.yaml`
- Output contract: `prompts/outputs/init.md`

## Guardrail

UX artifacts only. Do not implement product code or visual styling specs.

## Subagent hints

- **Fresh context:** `agents/research-synthesizer` for large doc corpus on brownfield establish/update
- Default: inline sequential
