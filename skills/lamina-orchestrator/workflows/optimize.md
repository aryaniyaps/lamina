# /lamina-optimize workflow

Audit one or more existing flows and return improvements ranked by impact vs effort.

## Input

- At least one of: flow name(s), screenshots, routes, URLs, or written description (required)
- Optional: primary user, business goals, known pain points

## Audit skills

Primary profile: `full-flow` in [audit-profiles.yaml](../audit-profiles.yaml).

## Procedure

1. Emit work plan — prompt `work-plan`.
2. Summarize each flow under audit.
3. Run audit lenses per flow — [parallel-review](../patterns/parallel-review.md) per flow if supported. In parallel, [persona-panel](../patterns/persona-panel.md) per flow when `personas.yaml` exists.
4. Load `lamina-decision-making` — score findings: impact × effort. Reconcile persona conflicts via primary-user filter.
5. Sort: high impact + low effort first; group quick wins and strategic bets.
6. Write simulation results to `.lamina/personas/simulations/<run_id>.yaml` when panel runs.
7. Merge into output contract — prompt `outputs/optimize`.

## Subagent hints

- **Parallel review** across audit lenses is the main win
- **Persona panel** per flow in parallel with expert lenses when `personas.yaml` exists
- Default: inline if parallel unavailable
