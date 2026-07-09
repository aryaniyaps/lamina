---
name: lamina
description: "Route product design for developers building with AI — design, verify, or direct capability answers."
disable-model-invocation: true
---

# /lamina

## Product

Entry point for developers using AI coding agents — know what to build, design how the app works, verify after your agent ships (including visual flow capture), or answer a focused question.

## Load

- `../lamina-orchestrator/SKILL.md`
- `../lamina-orchestrator/workflows/router.md`
- `../lamina-orchestrator/prerequisites/init-required.md`
- `../lamina-core/guardrails.md`
- On dispatch: matching workflow in `../lamina-orchestrator/workflows/`
- Direct mode: `../lamina-core/SKILL.md` → read one `lamina-<id>/SKILL.md`

## Guardrail

Writes: `.lamina/` only. Never app source. See [guardrails](../lamina-core/guardrails.md).
