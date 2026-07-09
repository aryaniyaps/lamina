---
name: lamina-design
description: "Design how the product works — domain, actors, workflows, invariants, UX surfaces — then ready_to_build + implement.md."
disable-model-invocation: true
---

# /lamina-design

## Product

End-to-end product design at the intersection of UX, product rules, and systems thinking. Emits a machine contract and stack-agnostic `implement.md`. Does not write app source.

## Load

- `../lamina-orchestrator/SKILL.md`
- `../lamina-orchestrator/workflows/design.md`
- `../lamina-orchestrator/audit-profiles.yaml`
- `../lamina-orchestrator/artifacts.md`
- `../lamina-orchestrator/prerequisites/init-required.md`
- Output contract: `../lamina-orchestrator/prompts/outputs/design.md`
- Blocked output: `../lamina-orchestrator/prompts/outputs/init-blocked.md`

## Prerequisite

Valid `.lamina/business-context.md` from `/lamina-init`.

## Guardrail

Writes: `.lamina/` only. Never app source. See [guardrails](../lamina-core/guardrails.md).

## Routing

Improve/fix shipped UI → `/lamina-verify`. After design completes, user implements externally, then `/lamina-verify`.

## Subagent hints

- **Fresh context:** brownfield source sets — bounded scan per [field-research](../lamina-field-research/SKILL.md)
- **Intake:** `design-intake` + `design-evidence` profiles from [audit-profiles.yaml](../lamina-orchestrator/audit-profiles.yaml)
- **Parallel review:** accessibility + risks when supported (`heuristic-review` pattern)
- Default: inline sequential
