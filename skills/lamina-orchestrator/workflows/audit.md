# /lamina-audit workflow

Audit one or more existing flows and return improvements ranked by impact vs effort.

## Input

- At least one of: flow name(s), screenshots, routes, URLs, or written description (required)
- Optional: primary user, business goals, known pain points

## Audit skills

Primary profile: `full-flow` in [audit-profiles.yaml](../audit-profiles.yaml).

## Procedure

0. **Init gate** — run [init-required](../prerequisites/init-required.md). On failure: emit `init-blocked` contract **verbatim** and **STOP**. On success: read `.lamina/business-context.md` and filter findings through business goals and success metrics. If prior runs exist and user did not specify flows, suggest audit targets from `.lamina/runs/*/run.yaml` `flows[]`. **Never** treat `personas.yaml` as business context or as proof init ran.
1. **Create run** — `.lamina/runs/<run_id>/run.yaml` with `hook: audit` per [artifacts.md](../artifacts.md).
2. Emit work plan — prompt `work-plan`.
3. Summarize each flow under audit.
4. Run audit lenses per flow — **prefer** [parallel-review](../patterns/parallel-review.md) (one lens subagent per skill) over loading all 11 `full-flow` skills inline. In parallel, [persona-panel](../patterns/persona-panel.md) per flow when `personas.yaml` exists. **Full-flow profile is mandatory**. If no target is described, list gaps — do not invent UI. For `@path` citations without screenshots, routes, or repo context, write `insufficient detail — cannot verify` per [merge-rules](../merge-rules.md) before any finding.
5. Load `lamina-decision-making` — score findings: impact × effort. Write `findings[]` to `run.yaml`. Reconcile persona conflicts via primary-user filter.
6. Sort: high impact + low effort first; group quick wins and strategic bets.
7. **Blueprint (optional):** Offer preview checkpoint — prompt `checkpoints/blueprint-preview`. Load [lamina-blueprint](../../lamina-blueprint/SKILL.md) and [lamina-edge-cases](../../lamina-edge-cases/SKILL.md). Read `run.yaml` to author blueprint TSX; set `screens[].status: existing` with `source`/`elements` for audited screens; set `blueprint_id` in `run.yaml` and `run_id` in `meta.yaml`. Write scenario variant TSX for edge cases in `run.yaml` `scenarios[]`.
8. Write audited flows to `run.yaml` `flows[]` (`status: shipped`); record ids in `flows_touched`. Add `simulation` to `run.yaml` when panel runs.
9. Merge into narrative contract — prompt `outputs/audit`. Write `runs/<run_id>/report.md`. Run `lamina-blueprint validate run .lamina/runs/<run_id>/run.yaml`. On conflicts, append to global `decisions.md` with `run_id`.

## Subagent hints

- **Parallel review** across audit lenses is the main win
- **Persona panel** per flow in parallel with expert lenses when `personas.yaml` exists
- **Prefer parallel lens subagents** over inline 11-skill load when host supports Task
- Default: inline only if parallel unavailable
