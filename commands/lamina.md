---
description: Route UX requests to ideate, feature, optimize, or direct capability answers.
disable-model-invocation: true
---

# /lamina

## Product

One entry point that detects what you need and runs the right workflow — or answers a single-topic UX question directly.

## Load

- `skills/lamina-orchestrator/SKILL.md`
- `skills/lamina-orchestrator/workflows/router.md`
- On dispatch: matching workflow in `skills/lamina-orchestrator/workflows/`
- Direct mode: `skills/lamina-core/SKILL.md` → one `lamina-<id>/SKILL.md`

## Guardrail

UX artifacts only. Do not implement product code or visual styling specs.

## Subagent hints

- Inherit hints from the dispatched workflow
- Direct mode: inline only
