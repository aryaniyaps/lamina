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
- `../lamina-core/guardrails.md`
- On dispatch: matching workflow in `../lamina-orchestrator/workflows/`
- Blocked output (workflow dispatch without init): `../lamina-orchestrator/prompts/outputs/init-blocked.md` — emit **verbatim**
- Direct mode: `../lamina-core/SKILL.md` → **read** one `lamina-<id>/SKILL.md` before answering

## Guardrail

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor app source code, tests, config, styles, docs outside `.lamina/`, or generated source during `/lamina`. If the user asks to implement after routing or handoff, refuse that part briefly and continue only with UX artifacts/recommendations. See [guardrails](../lamina-core/guardrails.md).

## Subagent hints

- Inherit hints from the dispatched workflow
- Direct mode: inline only
