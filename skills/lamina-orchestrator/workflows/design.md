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
5. Work sections in merge order (see [merge-rules.md](../merge-rules.md)). For each section, load supporting skills **as needed** to write that section’s fields (not a full catalog pre-read). **Write `run.yaml` early** and expand it — do not wait until every supporting skill is loaded.
6. **Domain** — write `domain` block; load systems skills from profile as needed.
7. **Actors** — update `personas.yaml` / `actors` in run (load `lamina-user-modeling`). Every brief-named persona (e.g. primary budgeter, partner, occasional viewer) appears in `actors[]` with permissions / `resource_filters` that match the brief privacy rules.
8. **Workflows** — write `workflows`. **Brief coverage (hard):** every primary flow named in the task brief (e.g. onboarding, account linking, weekly review, category adjustment, spending alerts, invite partner, household settings) must have a `workflows[]` id — do **not** ship a thinner “MVP” subset.
9. **Dependencies (first-class)** — write `domain.dependencies[]` with `mode`, `degraded_surfaces` / `recovery` as required; set `workflows[].requires` or `standalone: true` + optional `provides`. **Read** [lamina-dependencies](../../lamina-dependencies/SKILL.md). **Never** free-text `preconditions` or freestyle `edge_cases`.
10. **Scenarios** — write `scenarios[]` with **`acceptance`**; every dependency edge gets `dependency_ref` + `when: dependency_unmet` (set `scenario_ref` on the edge). Load edge-case skills from profile. Include **every** brief-named edge/recovery case (e.g. zero-income month, empty accounts, sync failure, duplicate transactions, partner privacy) as scenarios — not freestyle `edge_cases`.
11. **UX surfaces** — `screens[]` tied to workflows; every brief primary flow gets at least one `screens[]` with `status: new` (or `existing` + `source` when brownfield). Every `status: new` screen has **`a11y`** (`labels`, `touch_min_px`, `color_not_only`). Load [lamina-accessibility](../../lamina-accessibility/SKILL.md).
12. **Trade-offs** — write `tradeoffs[]` with **stable snake_case ids**. Prefer brief/golden wording verbatim (e.g. `clarity_vs_granularity`, `shared_view_vs_partner_privacy`). Load [lamina-tradeoffs](../../lamina-tradeoffs/SKILL.md).
13. **Scope + seed** — `out_of_scope[]`, `forbidden_content[]` (every brief ban → list entry), `seed` (fixture world including negative cases used by scenarios). Do **not** put brief-required flows into `out_of_scope`.
14. **Brief coverage matrix (before validate)** — confirm each brief primary flow → workflow + screen; each brief edge case → scenario; each brief persona → actor; each brief tradeoff / ban → tradeoffs[] / forbidden_content[]. Gaps → fix contract before validate.
15. **Contract simulation** — brief inline persona/unmet-dependency walks (or a short persona panel). Fold gaps into deps/scenarios/screens/a11y. Prefer finishing a valid contract over a long simulation transcript.
16. **Validate (hard gate)** — run `node .claude/skills/lamina-orchestrator/lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml` (path = orchestrator skill `lib/validate-run.mjs`; adjust agent skills root if not `.claude/skills`). On failure: fix contract and re-run; **do not** set `ready_to_build`; **do not** write freestyle paths. If the validator file is missing from the skill tree, **STOP** and report infrastructure error — do not emit `implement.md` or claim design complete.
17. **Implement brief (disk)** — **Write** ship-pack `implement.md` from [prompts/outputs/implement.md](../prompts/outputs/implement.md) (Reachability graph + **Must-implement checklist**) with the Write tool. Chat-only paste does not count. Checklist must include **every** brief-covered screen/workflow/scenario id. **Do not** copy Mode B / “do not edit app source” into that file — Mode B is this slash command only.
18. **Flip status** — Edit/Write `run.yaml` so `status: ready_to_build` **only after** step 16 passed and `implement.md` exists on disk. Leaving `status: designing` after a draft `run.yaml` is incomplete — do not end the command there.
19. Write `report.md` (optional narrative). Then **End Lamina command** — `.lamina/` only. Do **not** write app source or tick Must-implement as if shipped during this command.
    - **Interactive:** hand off — implement from `run.yaml` + `implement.md` end to end in a coding session, then `/lamina-verify`.
    - **Agent-primary / unattended:** after this command finishes `.lamina/` artifacts (`ready_to_build` + `implement.md` on disk), the **host’s next user turn** implements the full contract (app source allowed). Do not implement app source inside `/lamina-design`.

**Refuse to end** while `status` is still `designing` or while `implement.md` is missing under the run dir. Before the final design reply, run the existence gate: `test -f .lamina/runs/<run_id>/implement.md && grep -q '^status:[[:space:]]*ready_to_build' .lamina/runs/<run_id>/run.yaml`. Ending with “next step: generate implement.md / flip status” is a failed design.

## Subagent hints

- **Fresh context:** large repo reads → [fresh-context](../patterns/fresh-context.md)
- **Contract simulation:** persona panel after scenarios/UX, before validate — must walk unmet deps
- **Parallel review:** accessibility + risks when supported
- Default: inline sequential
- **No** blueprint studio, artifact packs, or Agent fallbacks that invent filenames
