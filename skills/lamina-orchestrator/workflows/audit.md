# /lamina-audit workflow

Audit one or more existing flows and return improvements ranked by impact vs effort.

## Input

- At least one of: flow name(s), screenshots, routes, URLs, or written description (required)
- Optional: primary user, business goals, known pain points

## Audit skills

Primary profile: `full-flow` in [audit-profiles.yaml](../audit-profiles.yaml).

## Procedure

0. **Init gate** — run [init-required](../prerequisites/init-required.md). On failure: emit `init-blocked` contract **verbatim** and **STOP**. On success: read `.lamina/business-context.md` and filter findings through business goals and success metrics. If `.lamina/flows-inventory.yaml` exists and user did not specify flows, suggest audit targets from inventory. **Never** treat `personas.yaml` as business context or as proof init ran.
1. **Create run** — `.lamina/runs/<run_id>/meta.yaml` with `hook: audit` per [artifacts.md](../artifacts.md).
2. Emit work plan — prompt `work-plan`.
3. Summarize each flow under audit.
4. Run audit lenses per flow — **prefer** [parallel-review](../patterns/parallel-review.md) (one lens subagent per skill) over loading all 11 `full-flow` skills inline. In parallel, [persona-panel](../patterns/persona-panel.md) per flow when `personas.yaml` exists. **Full-flow profile is mandatory** — run all lenses in [audit-profiles.yaml](../audit-profiles.yaml) `full-flow`. If the user asks to skip lenses or audit "only 3 lenses", refuse truncation and run the full profile (or explain which lenses you are running and why none are omitted). If no target is described, list gaps — do not invent UI. For `@path` citations without screenshots, routes, or repo context, write `insufficient detail — cannot verify` per [merge-rules](../merge-rules.md) before any finding.
5. Load `lamina-decision-making` — score findings: impact × effort. Reconcile persona conflicts via primary-user filter.
6. Sort: high impact + low effort first; group quick wins and strategic bets.
7. **Blueprint (optional):** Offer preview checkpoint — prompt `checkpoints/blueprint-preview`. Load [lamina-blueprint](../../lamina-blueprint/SKILL.md) and [lamina-edge-cases](../../lamina-edge-cases/SKILL.md). When evidence exists, write `structure-manifest.yaml` for audited screens before hydration; set `meta.blueprint_id`. Audit **one flow at a time**: write the recommended design to `screens/` or add a new `<Flow id>` with `flows/<id>/screens/` overrides (no manifest row for overrides); add edge cases to `scenarios.yaml` per lamina-edge-cases schema.
8. Append or update audited flows in `.lamina/flows-inventory.yaml` (`status: shipped`) per [artifacts.md](../artifacts.md); record ids in `meta.flows_touched`. Write `runs/<run_id>/simulation.yaml` when panel runs.
9. Merge into output contract — prompt `outputs/audit`. Write `runs/<run_id>/output.md`. On conflicts, append to global `decisions.md` with `run_id`.

## Subagent hints

- **Parallel review** across audit lenses is the main win
- **Persona panel** per flow in parallel with expert lenses when `personas.yaml` exists
- **Prefer parallel lens subagents** over inline 11-skill load when host supports Task
- Default: inline only if parallel unavailable
