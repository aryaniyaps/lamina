# /lamina-design — feature track

Turn a feature idea into an implementation-ready UX spec with risks, accessibility, and success criteria.

## Input

- Feature idea (required)
- Optional: existing product context, primary user, constraints

## Sections and profiles

| Section | Profile |
|---|---|
| Problem definition | `feature-problem` |
| Jobs to be done | `feature-jobs` |
| Assumptions | `feature-assumptions` |
| User goals | `feature-goals` |
| Flows | `feature-flows` |
| Edge cases | `feature-edge-cases` |
| Risks | `feature-risks` |
| Accessibility review | `feature-a11y` |
| Success metrics | `feature-metrics` |
| Implementation checklist | `feature-checklist` |

Resolve skills from [audit-profiles.yaml](../audit-profiles.yaml).

## Procedure

0. **Init gate** — run [init-required](../prerequisites/init-required.md). On failure: emit `outputs/init-blocked` and **STOP**. On success: read `.lamina/business-context.md` and align problem definition and scope with business context.
1. Emit work plan — prompt `work-plan`.
2. Work through sections in order (problem → flows).
3. **After flows:** Append feature flows to `.lamina/flows-inventory.yaml` (`status: planned`) per [artifacts.md](../artifacts.md); record ids in `meta.flows_touched`. [persona-panel](../patterns/persona-panel.md) if `.lamina/personas.yaml` exists; write `runs/<run_id>/simulation.yaml`; feed conflicts into Risks. Offer optional blueprint preview — prompt `checkpoints/blueprint-preview`; load [lamina-blueprint](../../lamina-blueprint/SKILL.md); set `meta.blueprint_id` when created. When the feature reuses shipped screens, classify steps **existing** vs **new**; write `structure-manifest.yaml` for existing only; design new screens directly in blueprint TSX (partial manifest is valid).
4. Continue remaining sections. For **Edge cases:** load [lamina-edge-cases](../../lamina-edge-cases/SKILL.md); run transient operation inventory; write `scenarios.yaml` + variant TSX when blueprint exists, else structured table in feature output (see [lamina-edge-cases](../../lamina-edge-cases/SKILL.md)).
5. **Before implementation checklist:** Offer blueprint preview checkpoint again if blueprint exists; approve before writing `runs/<run_id>/requirements.md` and `runs/<run_id>/implementation-tasks.md`.
6. Accessibility and risks: [parallel-review](../patterns/parallel-review.md) if host supports it.
7. Merge into output contract — prompt `outputs/design-feature`. Write `runs/<run_id>/output.md`.
8. On conflicts, load `lamina-decision-making`; append to global `decisions.md` with `run_id`.

Implementation checklist: actionable UX tasks with acceptance criteria. Write to `runs/<run_id>/implementation-tasks.md`. No product code.

## Subagent hints

- **Persona panel:** after flows
- **Parallel review:** accessibility + risks (+ optionally trust)
- Default: inline sequential
