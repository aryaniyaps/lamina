---
name: lamina-design
description: "Design how the product works — domain, actors, workflows, dependencies, invariants, UX surfaces — then ready_to_build + implement.md."
disable-model-invocation: true
---

# /lamina-design

## Product

End-to-end product design at the intersection of UX, product rules, and systems thinking. Emits a machine contract, contract-time persona simulation, and stack-agnostic ship-pack `implement.md`. Does not write app source.

## Required reads (do this before anything else)

You are already inside this slash skill. **Do not** call `Skill` for `lamina-design`.

The skill base directory is printed above this body (`Base directory for this skill: …`). Resolve every path below from that base (or its parent `skills/` tree).

**Your first tool calls must be `Read` on each of these files, in order. Do not Write under `.lamina/` until all of them are read.**

1. `../lamina-orchestrator/load-protocol.md`
2. `../lamina-orchestrator/SKILL.md`
3. `../lamina-orchestrator/workflows/design.md`
4. `../lamina-orchestrator/artifacts.md`
5. `../lamina-orchestrator/audit-profiles.yaml`
6. `../lamina-orchestrator/prerequisites/init-required.md`
7. `../lamina-orchestrator/prompts/outputs/design.md`
8. `../lamina-orchestrator/prompts/outputs/implement.md`

Then follow `workflows/design.md`. When a section names a profile in `audit-profiles.yaml`, **Read** (or Skill-invoke) each listed supporting skill’s `SKILL.md` before applying that section — e.g. `lamina-dependencies`, `lamina-edge-cases`, `lamina-user-modeling`, `lamina-system-structure`, `lamina-invariants`. Supporting skills are model-loadable; this slash skill is not.

**Do not invent artifact paths.** Only names in `artifacts.md` (`.lamina/runs/<run_id>/run.yaml`, `implement.md`, …). Never `contract.md`, `persona-simulation.md`, or `.lamina/ready_to_build/`.

**Completion gate:** Do not set `status: ready_to_build` until `node lib/validate-run.mjs` passes and both `run.yaml` + ship-pack `implement.md` (with Must-implement checklist) exist under `.lamina/runs/<run_id>/`.

**Do not** spawn Agent/Task to “run lamina-design” with a homemade file list. Agent/Task only when a **loaded** skill requests persona panel / parallel review.

## Prerequisite

Valid `.lamina/business-context.md` from `/lamina-init`.

## Guardrail

Writes: `.lamina/` only. Never app source. See [guardrails](../lamina-core/guardrails.md).

## Routing

Improve/fix shipped UI → `/lamina-verify`. After design completes, user implements externally, then `/lamina-verify`.

## Subagent hints

- **Fresh context:** brownfield — [field-research](../lamina-field-research/SKILL.md)
- **Contract simulation:** [persona-panel](../lamina-orchestrator/patterns/persona-panel.md) after scenarios/UX are drafted
- Validate with `node lib/validate-run.mjs` before `ready_to_build`
