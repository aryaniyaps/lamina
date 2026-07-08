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
3. **After flows:** Write `flows[]` and `screens[]` to `run.yaml` per [artifacts.md](../artifacts.md); record ids in `flows_touched`. [persona-panel](../patterns/persona-panel.md) if `.lamina/personas.yaml` exists; add `simulation` to `run.yaml`; feed conflicts into Risks. Offer optional UX Review Studio — prompt `checkpoints/blueprint-preview`; load [lamina-studio](../../lamina-studio/SKILL.md); read `run.yaml` to author blueprint screen TSX; set `blueprint_id` in `run.yaml` and `run_id` in `meta.yaml`. When the feature reuses shipped screens, set `screens[].status: existing` with `source` and `elements` in `run.yaml`.
4. Continue remaining sections. For **Edge cases:** load [lamina-edge-cases](../../lamina-edge-cases/SKILL.md); run transient operation inventory; write `scenarios[]` to `run.yaml`; write scenario variant TSX in blueprint when checkpoint accepted.
5. **Before implementation checklist:** Offer UX Review Studio checkpoint again if blueprint exists; approve before writing `checklist[]` to `run.yaml` and `### Blueprint handoff` to `report.md`.
6. Accessibility and risks: [parallel-review](../patterns/parallel-review.md) if host supports it.
7. Merge into narrative contract — prompt `outputs/design-feature`. Write `runs/<run_id>/report.md`. Run `lamina-studio validate run .lamina/runs/<run_id>/run.yaml`.
8. On conflicts, load `lamina-decision-making`; append to global `decisions.md` with `run_id`.

Implementation checklist: actionable UX tasks with acceptance criteria in `run.yaml` `checklist[]`. No product code.

## Subagent hints

- **Persona panel:** after flows
- **Parallel review:** accessibility + risks (+ optionally trust)
- Default: inline sequential
