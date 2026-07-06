# /lamina-optimize workflow

Audit one or more existing flows and return improvements ranked by impact vs effort.

## Input

- At least one of: flow name(s), screenshots, routes, URLs, or written description (required)
- Optional: primary user, business goals, known pain points

## Audit skills

Primary profile: `full-flow` in [audit-profiles.yaml](../audit-profiles.yaml).

## Procedure

0. If `.lamina/business-context.md` exists, read it — filter findings through business goals and success metrics. If missing, note the gap; do not auto-run init. If `.lamina/flows-inventory.yaml` exists and user did not specify flows, suggest audit targets from inventory.
1. Emit work plan — prompt `work-plan`.
2. Summarize each flow under audit.
3. Run audit lenses per flow — **prefer** [parallel-review](../patterns/parallel-review.md) (one lens subagent per skill) over loading all 11 `full-flow` skills inline. In parallel, [persona-panel](../patterns/persona-panel.md) per flow when `personas.yaml` exists. If no target is described, list gaps — do not invent UI.
4. Load `lamina-decision-making` — score findings: impact × effort. Reconcile persona conflicts via primary-user filter.
5. Sort: high impact + low effort first; group quick wins and strategic bets.
6. **Blueprint (optional):** Offer preview checkpoint — prompt `checkpoints/blueprint-preview`. Load [lamina-blueprint](../../lamina-blueprint/SKILL.md). Optimize **one flow at a time**: write the recommended design to `screens/` or add a new `<Flow id>` with `flows/<id>/screens/` overrides; add edge cases to `scenarios.yaml`.
7. Append or update audited flows in `.lamina/flows-inventory.yaml` (`status: shipped`) per [artifacts.md](../artifacts.md). Write simulation results to `.lamina/personas/simulations/<run_id>.yaml` when panel runs.
8. Merge into output contract — prompt `outputs/optimize`.

## Subagent hints

- **Parallel review** across audit lenses is the main win
- **Persona panel** per flow in parallel with expert lenses when `personas.yaml` exists
- **Prefer parallel lens subagents** over inline 11-skill load when host supports Task
- Default: inline only if parallel unavailable
