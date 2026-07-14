# /lamina-design workflow

Design how the product works — domain, actors, workflows, invariants, and UX surfaces — then emit the ship-pack `implement.md` for external build.

## Boundary

| Signal | Dispatch |
|--------|----------|
| New feature, problem, capability | Continue design workflow |
| Improve/fix shipped UI | Route to [verify.md](verify.md) (brownfield verify) |
| Ambiguous | Ask: *"Design new behavior, or verify existing product?"* |

## Sections and profiles

Load skills from [audit-profiles.yaml](../audit-profiles.yaml) per section. Keep **intake** and **evidence** (competitive analysis, field research, interview docs) — especially when humans answer clarifying questions.

| Section | Profile | Notes |
|---------|---------|-------|
| Scope intake | `design-intake` | Problem, discovery, acceptance criteria |
| Evidence plan | `design-evidence` | Repo/walkthrough grounding; research when sources or answers exist |
| Domain charter | `design-domain` | Entities, relationships, states, invariants, dependencies |
| Actors and permissions | `design-actors` | Cast, roles, what each may do |
| Workflows | `design-workflows` | User journeys over operations/states |
| Dependencies | `design-workflows` | Reachability graph — after workflows, before scenarios |
| Scenarios | `design-scenarios` | Violations, unmet deps, conflicts, recovery + **acceptance** |
| UX surfaces | `design-ux` | Nav, screens, forms, feedback bound to domain |
| Trade-offs | `design-risks` | Material decisions (not ops milestones) |

## Procedure

0. **Required reads** — The slash `/lamina-design` skill lists files that **must** be Read before any `.lamina/` Write. Do that first. Then continue here.
1. **Init gate** — [init-required](../prerequisites/init-required.md). On failure: `init-blocked` and **STOP**.
2. **Scope intake** — business context, prior runs, sources. Blocking gaps → `clarify` and **STOP** (interactive). **Agent-primary:** if the brief already has goals, users, and constraints, label assumptions and continue — do not clarify-and-STOP.
3. **Create run** — `.lamina/runs/<run_id>/run.yaml`, `status: designing`, `hook: design`.
4. Emit work plan.
5. Work sections in merge order (see [merge-rules.md](../merge-rules.md)). For each section, **Read/Skill-load** every skill in that section’s `audit-profiles.yaml` profile before writing contract fields.
6. **Domain** — write `domain` block; load systems skills from profile.
7. **Actors** — update `personas.yaml` / `actors` in run (load `lamina-user-modeling`).
8. **Workflows** — write `workflows`.
9. **Dependencies (first-class)** — write `domain.dependencies[]` with `mode`, `degraded_surfaces` / `recovery` as required; set `workflows[].requires` or `standalone: true` + optional `provides`. **Read** [lamina-dependencies](../../lamina-dependencies/SKILL.md). **Never** free-text `preconditions` or freestyle `edge_cases`.
10. **Scenarios** — write `scenarios[]` with **`acceptance`**; every dependency edge gets `dependency_ref` + `when: dependency_unmet` (set `scenario_ref` on the edge). Load edge-case skills from profile. Include brief-named empty/zero-domain cases (e.g. zero-income month, empty accounts) as scenarios — not freestyle `edge_cases`.
11. **UX surfaces** — `screens[]` tied to workflows; every `status: new` screen has **`a11y`** (`labels`, `touch_min_px`, `color_not_only`). Brownfield: `status: existing` + `source`. Load [lamina-accessibility](../../lamina-accessibility/SKILL.md).
12. **Trade-offs** — write `tradeoffs[]` with **stable snake_case ids**. Prefer brief/golden wording verbatim (e.g. `clarity_vs_granularity`, not a synonym). Load [lamina-tradeoffs](../../lamina-tradeoffs/SKILL.md).
13. **Scope + seed** — `out_of_scope[]`, `forbidden_content[]` (every brief ban → list entry), `seed` (fixture world including negative cases used by scenarios).
14. **Contract simulation** — persona panel including **unmet-dependency walks** and forbidden-content absence; fold gaps into deps/scenarios/screens/a11y.
15. **Validate (hard gate)** — run `node lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml`. On failure: fix contract; **do not** set `ready_to_build`; **do not** write freestyle paths.
16. **Implement brief** — write ship-pack `implement.md` from [prompts/outputs/implement.md](../prompts/outputs/implement.md) (Reachability graph + **Must-implement checklist**). **Do not** copy Mode B / “do not edit app source” into that file — Mode B is this slash command only. Set `status: ready_to_build` only after step 15 passes and both `run.yaml` + `implement.md` exist under `.lamina/runs/<run_id>/`.
17. Write `report.md`.
18. **End Lamina command** — `.lamina/` only. Do **not** write app source or tick Must-implement as if shipped during this command.
    - **Interactive:** hand off — implement from `run.yaml` + `implement.md` end to end in a coding session, then `/lamina-verify`.
    - **Agent-primary / unattended:** after this command finishes `.lamina/` artifacts, the **host’s next user turn** implements the full contract from `run.yaml` + `implement.md` (app source allowed). Do not implement app source inside `/lamina-design`.

## Subagent hints

- **Fresh context:** large repo reads → [fresh-context](../patterns/fresh-context.md)
- **Contract simulation:** persona panel after scenarios/UX, before validate — must walk unmet deps
- **Parallel review:** accessibility + risks when supported
- Default: inline sequential
- **No** blueprint studio, artifact packs, or Agent fallbacks that invent filenames
