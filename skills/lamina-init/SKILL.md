---
name: lamina-init
description: "Use only when explicitly invoked as lamina-init. Turn an incomplete product idea into usable business context and evidence-grounded personas, asking only high-leverage questions and labeling provisional assumptions for later product-graph design."
---

# /lamina-init

## Product

Capture the minimum context needed to shape the product and persist it in `.lamina/business-context.md`. Establish mode also writes evidence-grounded `.lamina/personas.json` using Contract v2.

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

Then follow `workflows/init.md`. Load `lamina-user-modeling` before writing `personas.json`; load other supporting skills only when the product evidence requires them.

`business-context.md` must use every canonical `##` section heading from `lamina-business-context` exactly once. Do not combine or rename required sections (for example, keep `## Business goals` separate from `## Problem statement`, and `## Success metrics` separate from narrative success signals). Run the init check when available before reporting success.

**Do not invent artifact paths.** Only names in `artifacts.md`.

**Do not** spawn Agent/Task to “run lamina-init” with a homemade file list.

## Guardrail

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor application source. See [guardrails](../lamina-core/guardrails.md).

## Subagent hints

- **Brownfield:** [field-research](../lamina-field-research/SKILL.md)
- **Interactive:** prefer clarifying questions when humans can answer
- **Agent-primary:** if the brief already has goals, users, scope, and constraints, extract + label assumptions; do not clarify-and-STOP
