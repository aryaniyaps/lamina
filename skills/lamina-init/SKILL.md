---
name: lamina-init
description: "Use only when explicitly invoked as lamina-init. Turn an incomplete product idea into usable business context and evidence-grounded personas, asking only high-leverage questions and labeling provisional assumptions for later product-graph design."
---

# /lamina-init

## Product

Capture the minimum context needed to shape the product and persist it in `.lamina/business-context.md`. Establish mode also writes evidence-grounded `.lamina/personas.json` using Contract v2.

**Establish mode must create both** `.lamina/business-context.md` and `.lamina/personas.json` before you respond. Never edit application source (`src/`, `app/`, `lib/`, etc.) even when the user asks to refactor or implement — init writes `.lamina/` only.

## Establish artifacts (non-negotiable)

1. **`.lamina/business-context.md`** — YAML frontmatter with `lamina:` metadata, then these `##` headings **exactly once each** (copy names verbatim):
   `Problem statement`, `Business goals`, `Success metrics`, `Scope`, `Users & market`, `Product posture`, `Constraints`, `Stakeholders`, `Risks & unknowns`, `Research posture`, `Triad check`.
   Each section needs a non-placeholder `**Answer:**` line plus confidence/evidence per `lamina-business-context`.
2. **`.lamina/personas.json`** — `contract_version: "2.0"`, evidence-grounded personas (≥2 in establish mode), each with `id`, `role`, goals, constraints, `confidence`, and `evidence` refs. **Filename must be `personas.json` — never `personas.yaml` or YAML.**

Run `node ../../scripts/check_lamina_init.mjs <workspace>` and `node ../../scripts/check_lamina_personas.mjs <workspace>` when available; do not report success while either check fails.

## Completion output contract

After writing artifacts, your response must use **these exact headings** from `../lamina-orchestrator/prompts/outputs/init.md`:

```markdown
## Init: <project or product name>
### Mode
establish | update
### Business context summary
Per section: answer, confidence (high | medium | low)
### Open questions
Only questions the user explicitly skipped, refused, or deferred
### Artifacts
- `.lamina/business-context.md` — created or updated
- `.lamina/personas.json` — created or updated (establish mode)
### Recommended next step
One command and why
```

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
