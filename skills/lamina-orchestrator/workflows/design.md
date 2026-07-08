# /lamina-design workflow

Design net-new UX in one workflow. The input may be a problem, a product idea, or a named capability; do not split the work into internal routes.

## Boundary

First strong match wins:

| Signal | Dispatch |
|---|---|
| New product, problem statement, idea, capability, or flow to add | Continue with this design workflow |
| Audit signals (`redesign`, `improve`, `fix`, existing flow, conversion optimization) | Route to [audit.md](audit.md) — not design |
| Ambiguous between net-new work and improving shipped UI | Ask **one** question: *"Are we designing new UX, or improving something that already exists?"* |

Use `.lamina/business-context.md` frontmatter (`maturity: greenfield | brownfield`) only to tune evidence gathering and screen status. It does not create a separate workflow.

## Sections and profiles

Resolve skills from [audit-profiles.yaml](../audit-profiles.yaml). Load each profile's skills before writing that section.

| Section | Profile | Notes |
|---|---|---|
| Problem framing | `design-problem` | Align user problem, business goals, constraints, and target outcome |
| Users and jobs | `design-users` | Read or update `.lamina/personas.yaml` when the cast is missing or stale |
| Assumptions and evidence | `design-assumptions` | Separate evidence, inference, and assumptions |
| Journey and information architecture | `design-structure` | Include only the structure needed for the requested scope |
| Flows | `design-flows` | Write `flows[]` and `screens[]` to `run.yaml`; set `screens[].status: existing` with `source` when reusing shipped screens |
| Screens | `design-screens` | Structure and behavior only — no visual styling specs |
| Interactions and copy | `design-interactions` | Controls, feedback, forms, labels, and tone principles |
| Edge cases and recovery | `design-edge-cases` | Load [lamina-edge-cases](../../lamina-edge-cases/SKILL.md); write `scenarios[]` when concrete operations exist |
| Risks and decisions | `design-risks` | Load `lamina-decision-making` for conflicts or material trade-offs |
| Accessibility review | `design-accessibility` | Keyboard, screen reader, cognitive load, and inclusive defaults |
| Metrics and validation | `design-metrics` | Success metrics, usability test tasks, and research plan |
| Handoff checklist | `design-handoff` | Write `checklist[]` when implementation tasks are clear enough for a later coding session |

## Procedure

0. **Init gate** — run [init-required](../prerequisites/init-required.md). On failure: emit `init-blocked` contract **verbatim** from `outputs/init-blocked.md` and **STOP**.
1. **Scope intake gate** — read `.lamina/business-context.md`, `.lamina/personas.yaml` if present, prior relevant `run.yaml` files, and user-provided sources. Require enough signal for target feature/flow/problem, primary user or persona, desired outcome, scope boundary, and material constraints. If any blocking item is missing, emit `outputs/clarify` with one batched question set and **STOP** before creating a run, work plan, personas, flows, screens, checklist, handoff, blueprint, or artifact pack.
2. **Skip/refusal handling** — if the user explicitly refuses, skips, or asks to proceed without answering blocking questions, continue only when there is still enough concrete target, user, outcome, and scope signal to produce a valid `run.yaml`. Otherwise emit a narrative plan/template response only, preserve unanswered items under **Open questions**, and **STOP** without creating or validating a design run. Cap any assumption-backed confidence at medium.
3. **Create run** — `.lamina/runs/<run_id>/run.yaml` per [artifacts.md](../artifacts.md). Set `hook: design`, `target`, `command: /lamina-design`, `personas_updated: false`, and `started_at`.
4. Emit work plan — prompt `work-plan`.
5. **Artifact work plan:** Load [artifact-catalog.yaml](../artifact-catalog.yaml). Check required inputs against business context, personas, prior runs, attached sources, and current scope. Mark each artifact as generate, generate-as-template, delegate, blocked, or skip. Record evidence candidates for `run.yaml` `evidence[]` or `evidence.md`.
6. Work through the sections in order. Keep sections concise when a prompt is narrow; still use the same workflow and contract.
7. **Cast:** If the design needs personas and `.lamina/personas.yaml` is missing or stale, write or append the cast and set `personas_updated: true`. Never overwrite an existing cast without user consent.
8. **Flows and screens:** Write `flows[]` and `screens[]` to `run.yaml` per [artifacts.md](../artifacts.md); record ids in `flows_touched`. If no flow or screen target is described after intake, do not create a design run; return a narrative plan/template with unanswered items under **Open questions** — do not invent UI.
9. **Persona panel:** When a concrete flow, screen set, or journey exists, run [persona-panel](../patterns/persona-panel.md). Add `simulation` to `run.yaml` and reconcile blockers into the narrative.
10. **UX Review Studio checkpoint:** Offer optional preview with `checkpoints/blueprint-preview` after `flows[]` and `screens[]` exist, before checklist handoff, and at final review when useful. Load [lamina-studio](../../lamina-studio/SKILL.md); read `run.yaml` to author blueprint TSX; set `blueprint_id` in `run.yaml` and `run_id` in `meta.yaml` when accepted.
11. **Edge cases:** Load [lamina-edge-cases](../../lamina-edge-cases/SKILL.md); run transient operation inventory; write `scenarios[]` to `run.yaml` when concrete operations exist. Write scenario variant TSX only when a blueprint checkpoint is accepted and a distinct screen state is needed.
12. **Review:** Use [parallel-review](../patterns/parallel-review.md) for accessibility, risks, or trust when the host supports it; otherwise run inline.
13. **Checklist and handoff:** Write `checklist[]` only when the design is concrete enough for future implementation tasks. Compile `.lamina/runs/<run_id>/handoff.md` with prompt `outputs/handoff`; if checklist quality is blocked, mark handoff confidence `blocked` and list missing design structure. Add `developer-handoff` to `run.yaml` `artifacts[]` when written.
14. **Artifact packs:** Use [patterns/artifact-subagents.md](../patterns/artifact-subagents.md). Generate relevant packs such as research, IA, journey, flow, interaction, validation, accessibility, strategy, and handoff. If evidence is missing, emit plans/templates instead of findings. Add entries to `run.yaml` `artifacts[]`.
15. Merge into narrative contract — prompt `outputs/design`. Write `runs/<run_id>/report.md`. Run `lamina-studio validate run .lamina/runs/<run_id>/run.yaml`.
16. On conflicts, load `lamina-decision-making` per [merge-rules.md](../merge-rules.md); append to global `decisions.md` with `run_id`.
17. **STOP** — command complete. Do not edit files outside `.lamina/`. If the user asks to implement now, refuse that part briefly and offer implementation only as a separate coding session using `handoff.md`, `checklist[]`, and/or blueprint handoff.

## Subagent hints

- **Fresh context:** large research docs or brownfield source sets → [fresh-context](../patterns/fresh-context.md)
- **Persona panel:** after flows/screens or journey exists
- **Parallel review:** accessibility + risks (+ optionally trust)
- **Artifact subagents:** after artifact work plan and again after `run.yaml` has flows/screens/scenarios/checklist; readonly only
- Default: inline sequential
