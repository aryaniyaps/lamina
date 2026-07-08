# /lamina-audit workflow

Audit one or more existing flows and return improvements ranked by impact vs effort.

## Input

- At least one of: flow name(s), screenshots, routes, URLs, or written description (required)
- Optional: primary user, business goals, known pain points

## Audit skills

Primary profile: `full-flow` in [audit-profiles.yaml](../audit-profiles.yaml).

## Procedure

0. **Init gate** — run [init-required](../prerequisites/init-required.md). On failure: emit `init-blocked` contract **verbatim** and **STOP**. On success: read `.lamina/business-context.md` and filter findings through business goals and success metrics. If prior runs exist and user did not specify flows, suggest audit targets from `.lamina/runs/*/run.yaml` `flows[]`. **Never** treat `personas.yaml` as business context or as proof init ran.
1. **Audit target gate** — require at least one concrete audit target: flow name, screenshot, route, URL, code reference with enough UI context, prior run flow, or written flow description. If no target is described, emit `outputs/clarify` with one batched question set and **STOP** before creating a run, work plan, findings, flows, handoff, blueprint, or artifact pack.
2. **Skip/refusal handling** — if the user explicitly refuses, skips, or asks to proceed without answering target questions, continue only with plan/template output or `insufficient detail — cannot verify` markers. Preserve unanswered targets under **Open questions** and do not invent UI.
3. **Create run** — `.lamina/runs/<run_id>/run.yaml` with `hook: audit` per [artifacts.md](../artifacts.md).
4. Emit work plan — prompt `work-plan`.
5. **Artifact work plan:** Load [artifact-catalog.yaml](../artifact-catalog.yaml). Check which audit, accessibility, validation, IA, journey, and handoff artifacts have enough evidence from routes, screenshots, repo references, prior runs, or user-provided context. Mark each artifact as generate, generate-as-template, delegate, blocked, or skip.
6. Summarize each flow under audit.
7. Run audit lenses per flow — **prefer** [parallel-review](../patterns/parallel-review.md) (one lens subagent per skill) over loading all 11 `full-flow` skills inline. In parallel, [persona-panel](../patterns/persona-panel.md) per flow when `personas.yaml` exists. **Full-flow profile is mandatory**. For `@path` citations without screenshots, routes, or repo context, write `insufficient detail — cannot verify` per [merge-rules](../merge-rules.md) before any finding.
8. Load `lamina-decision-making` — score findings: impact × effort. Write `findings[]` to `run.yaml`. Reconcile persona conflicts via primary-user filter.
9. Sort: high impact + low effort first; group quick wins and strategic bets.
10. **Blueprint (optional):** Offer UX Review Studio checkpoint — prompt `checkpoints/blueprint-preview`. Load [lamina-studio](../../lamina-studio/SKILL.md) and [lamina-edge-cases](../../lamina-edge-cases/SKILL.md). Read `run.yaml` to author blueprint screen TSX; set `screens[].status: existing` with `source`/`elements` for audited screens; set `blueprint_id` in `run.yaml` and `run_id` in `meta.yaml`. Scenario variant TSX is optional — coverage lives in `run.yaml` `scenarios[]`.
11. Write audited flows to `run.yaml` `flows[]` (`status: shipped`); record ids in `flows_touched`. Add `simulation` to `run.yaml` when panel runs.
12. **Artifact packs:** Use [patterns/artifact-subagents.md](../patterns/artifact-subagents.md). Generate relevant packs such as `artifacts/audit-pack.md`, `artifacts/accessibility-pack.md`, `artifacts/validation-pack.md`, and `artifacts/flow-pack.md`. Do not claim test sessions, measurements, or analytics unless provided. Add entries to `run.yaml` `artifacts[]`.
13. **Developer handoff:** Compile `.lamina/runs/<run_id>/handoff.md` with prompt `outputs/handoff`, mapping `findings[]` ids to recommended implementation acceptance criteria and tests. Add `developer-handoff` to `run.yaml` `artifacts[]`.
14. Merge into narrative contract — prompt `outputs/audit`. Write `runs/<run_id>/report.md`. Run `lamina-studio validate run .lamina/runs/<run_id>/run.yaml`. On conflicts, append to global `decisions.md` with `run_id`.
15. **STOP** — command complete. Do not edit files outside `.lamina/`. If the user asks to fix code now, refuse that part briefly and offer implementation only as a separate coding session using `handoff.md`, `findings[]`, and/or blueprint handoff.

## Subagent hints

- **Parallel review** across audit lenses is the main win
- **Persona panel** per flow in parallel with expert lenses when `personas.yaml` exists
- **Prefer parallel lens subagents** over inline 11-skill load when host supports Task
- **Artifact subagents** after findings are written; readonly only
- Default: inline only if parallel unavailable
