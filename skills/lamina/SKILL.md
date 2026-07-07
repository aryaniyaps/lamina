---
name: lamina
description: "Route UX requests to design, audit, or direct capability answers."
disable-model-invocation: true
---

# /lamina

## Product

One entry point that detects what you need and runs the right workflow — or answers a single-topic UX question directly.

## Load

- `../lamina-orchestrator/SKILL.md`
- `../lamina-orchestrator/workflows/router.md`
- `../lamina-orchestrator/prerequisites/init-required.md`
- On dispatch: matching workflow in `../lamina-orchestrator/workflows/`
- Blocked output (workflow dispatch without init): `../lamina-orchestrator/prompts/outputs/init-blocked.md`
- Direct mode: `../lamina-core/SKILL.md` → one `lamina-<id>/SKILL.md`

## Guardrail

UX artifacts only. Do not implement product code or visual styling specs.

## Subagent hints

- Inherit hints from the dispatched workflow
- Direct mode: inline only
