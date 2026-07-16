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
7. **Actors** — update `personas.yaml` / `actors` in run (load `lamina-user-modeling`). Every brief-named persona appears in `actors[]` with permissions / `resource_filters` that match the brief's ownership and visibility rules.
8. **Workflows** — write `workflows`. **Brief coverage (hard):** every primary flow named in the task brief must have a `workflows[]` id — do **not** ship a thinner “MVP” subset. Every domain noun the brief requires as a first-class record must also appear in `domain.entities[]`; do not silently fold required entities into a nearby type. For cross-actor handoffs, continue through a named delivery boundary, recipient open/accept/reject, authenticated recipient binding, trusted handoff-state validation, durable permission/relationship change, both actors' projections, and expiry/replay recovery; sender-only or verification-only handoff generation is incomplete.
9. **Dependencies (first-class)** — write `domain.dependencies[]` with `mode`, `degraded_surfaces` / `recovery` as required; set `workflows[].requires` or `standalone: true` + optional `provides`. **Read** [lamina-dependencies](../../lamina-dependencies/SKILL.md). **Never** free-text `preconditions` or freestyle `edge_cases`.
10. **Scenarios** — write `scenarios[]` with **`acceptance`**; every dependency edge gets `dependency_ref` + `when: dependency_unmet` (set `scenario_ref` on the edge). Load edge-case skills from profile. Include every brief-named edge, denial, degraded, and recovery case as scenarios — not freestyle `edge_cases`.
11. **UX surfaces** — `screens[]` tied to workflows; every brief primary flow gets at least one `screens[]` with `status: new` (or `existing` + `source` when brownfield). Every brief-named secondary surface/control (empty state, recovery UI, preferences, privacy control, and similar) must be assigned to a concrete screen and named in that screen's contract fields or scenario acceptance; do not leave secondary surfaces only in business context prose. Every `status: new` screen has **`a11y`** (`labels`, `touch_min_px`, `color_not_only`). Load [lamina-accessibility](../../lamina-accessibility/SKILL.md).
12. **Trade-offs** — write `tradeoffs[]` with **stable snake_case ids**. Derive ids and choices only from the current brief and product context. Load [lamina-tradeoffs](../../lamina-tradeoffs/SKILL.md).
13. **Scope + seed** — `out_of_scope[]`, `forbidden_content[]` (every brief ban → list entry), `seed` (fixture world including negative cases used by scenarios). Do **not** put brief-required flows into `out_of_scope`.
14. **Brief coverage matrix (before validate)** — confirm each required domain noun → entity; each product rule/invariant → invariant or permission filter; each primary flow → workflow + screen; each secondary surface/control → concrete screen behavior; each edge/recovery case → scenario; each persona → actor; each tradeoff / ban → tradeoffs[] / forbidden_content[]. Do this against the original brief, not only business-context summaries. Gaps → fix contract before validate.
15. **Executable-chain matrix** — for every primary workflow and critical scenario, specify in `implement.md` how the actor reaches it, the trusted boundary that enforces permissions/invariants, the state mutation and persistence/offline semantics, the actor-scoped read projection, and the observable result/recovery. Consequential privacy or shared-state rules must not rely only on client rendering. Add deterministic seed/reset paths for negative and recovery states; test names are not product evidence.
    - External dependency unavailable: specify a production-shaped port/adapter with begin, nonce/state, callback/exchange, durable attempt, retry, and replaceable local fake. Keep fixture selectors out of the primary product UI.
    - Consequential identity: specify server-bound session resolution outside isolated verification mode; make the boundary a named module/symbol. Credential-free requests reject or begin explicit onboarding/sign-in and never default to a privileged seed actor.
    - Identity proof: a local adapter must still verify control with a password, passkey, or delivered one-time/magic-link challenge; email/name selection alone is not authentication.
    - Organic edge states: specify where ordinary input, handoff, and dependency paths create their conflict, delivery, retry, and other recovery records; deterministic presets make them probeable but do not replace the production path.
    - Shared/offline state: specify concurrency control for consequential mutations, projection/snapshot refresh triggers, and honest sensitive-cache handling (real encryption boundary or explicit plaintext minimization; never call base64 encryption).
    - Durable commit: validate cross-record relationships and publish live/in-memory state only after the durable write succeeds; include a failure-injection acceptance showing no partial live or disk mutation.
    - Organic creation: every brief-critical entity, relationship, state, and lifecycle variant advertised by the UI has a normal create/configure path from the product's initial state.
    - Permission cross-product: map every consequential mutation against every role and explicitly scope status, acknowledgment, completion, and preference state to an actor or shared resource.
    - Interactive UI: specify navigation focus, invalid-field focus/association, async live announcements, busy state, and semantic progress/status.
16. **Contract simulation** — brief inline persona/unmet-dependency walks (or a short persona panel). Walk the executable chain, including a direct/client-bypass attempt for critical permissions and invariants. Fold gaps into deps/scenarios/screens/a11y. Prefer finishing a valid contract over a long simulation transcript.
17. **Validate (hard gate)** — run `node .claude/skills/lamina-orchestrator/lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml` (path = orchestrator skill `lib/validate-run.mjs`; adjust agent skills root if not `.claude/skills`). On failure: fix contract and re-run; **do not** set `ready_to_build`; **do not** write freestyle paths. If the validator file is missing from the skill tree, **STOP** and report infrastructure error — do not emit `implement.md` or claim design complete.
18. **Implement brief (disk)** — **Write** ship-pack `implement.md` from [prompts/outputs/implement.md](../prompts/outputs/implement.md) (Reachability graph + **Must-implement checklist**) with the Write tool. Chat-only paste does not count. Checklist must include **every** brief-covered screen/workflow/scenario id and its executable chain. **Do not** copy Mode B / “do not edit app source” into that file — Mode B is this slash command only.
    - For greenfield code, require a declared clean build/compile/typecheck command (for Node, `package.json#scripts.build`) in addition to tests and live smoke. The implementation phase must run it from a clean seed/workspace before handoff.
19. **Flip status** — Edit/Write `run.yaml` so `status: ready_to_build` **only after** step 17 passed and `implement.md` exists on disk. Leaving `status: designing` after a draft `run.yaml` is incomplete — do not end the command there.
20. Write `report.md` (optional narrative). Then **End Lamina command** — `.lamina/` only. Do **not** write app source or tick Must-implement as if shipped during this command.
    - **Interactive:** hand off — implement from `run.yaml` + `implement.md` end to end in a coding session, then `/lamina-verify`.
    - **Agent-primary / unattended:** after this command finishes `.lamina/` artifacts (`ready_to_build` + `implement.md` on disk), the **host’s next user turn** implements the full contract (app source allowed). Do not implement app source inside `/lamina-design`.

**Refuse to end** while `status` is still `designing` or while `implement.md` is missing under the run dir. Before the final design reply, run the existence gate: `test -f .lamina/runs/<run_id>/implement.md && grep -q '^status:[[:space:]]*ready_to_build' .lamina/runs/<run_id>/run.yaml`. Ending with “next step: generate implement.md / flip status” is a failed design.

## Subagent hints

- **Fresh context:** large repo reads → [fresh-context](../patterns/fresh-context.md)
- **Contract simulation:** persona panel after scenarios/UX, before validate — must walk unmet deps
- **Parallel review:** accessibility + risks when supported
- Default: inline sequential
- **No** blueprint studio, artifact packs, or Agent fallbacks that invent filenames
