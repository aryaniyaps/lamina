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

## Required reads (do this before anything else)

You are already inside this slash skill. **Do not** call `Skill` for `lamina-init`.

The skill base directory is printed above this body. Resolve paths from that base.

**Your first tool calls must be `Read` on each of these files, in order. Do not Write under `.lamina/` until all of them are read.**

1. `../lamina-orchestrator/load-protocol.md`
2. `../lamina-orchestrator/SKILL.md`
3. `../lamina-orchestrator/workflows/init.md`
4. `../lamina-orchestrator/artifacts.md`
5. `../lamina-orchestrator/audit-profiles.yaml`
6. `../lamina-business-context/SKILL.md`
7. `../lamina-orchestrator/prompts/outputs/init.md`

Then follow `workflows/init.md`. When it (or the `init` profile in `audit-profiles.yaml`) names supporting skills, **Read** or Skill-invoke each — at minimum `lamina-user-modeling` before writing `personas.yaml`. Supporting skills are model-loadable; this slash skill is not.

**Do not invent artifact paths.** Only names in `artifacts.md`.

**Do not** spawn Agent/Task to “run lamina-init” with a homemade file list.

## Guardrail

Writes: `.lamina/` only. Repo: read-only. See [guardrails](../lamina-core/guardrails.md).

## Subagent hints

- **Brownfield:** [field-research](../lamina-field-research/SKILL.md)
- **Interactive:** prefer clarifying questions when humans can answer
- **Agent-primary:** if the brief already has goals, users, scope, and constraints, extract + label assumptions; do not clarify-and-STOP
