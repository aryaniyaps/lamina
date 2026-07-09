# /lamina-design workflow

Design how the product works — domain, actors, workflows, invariants, and UX surfaces — then emit `implement.md` for external build.

## Boundary

| Signal | Dispatch |
|--------|----------|
| New feature, problem, capability | Continue design workflow |
| Improve/fix shipped UI | Route to [verify.md](verify.md) (brownfield verify) |
| Ambiguous | Ask: *"Design new behavior, or verify existing product?"* |

## Sections and profiles

Load skills from [audit-profiles.yaml](../audit-profiles.yaml) per section.

| Section | Profile | Notes |
|---------|---------|-------|
| Scope intake | `design-intake` | Problem, discovery, acceptance criteria |
| Evidence plan | `design-evidence` | Repo/walkthrough grounding |
| Domain charter | `design-domain` | Entities, relationships, states, invariants |
| Actors and permissions | `design-actors` | Cast, roles, what each may do |
| Workflows | `design-workflows` | User journeys over operations/states |
| Scenarios | `design-scenarios` | Violations, conflicts, recovery |
| UX surfaces | `design-ux` | Nav, screens, forms, feedback bound to domain |
| Trade-offs | `design-risks` | Material decisions |

## Procedure

0. **Init gate** — [init-required](../prerequisites/init-required.md). On failure: `init-blocked` and **STOP**.
1. **Scope intake** — business context, prior runs, sources. Blocking gaps → `clarify` and **STOP**.
2. **Create run** — `.lamina/runs/<run_id>/run.yaml`, `status: designing`, `hook: design`.
3. Emit work plan.
4. Work sections in merge order (see [merge-rules.md](../merge-rules.md)).
5. **Domain** — write `domain` block; load systems skills from profile.
6. **Actors** — update `personas.yaml` / `actors` in run.
7. **Workflows** — write `workflows` (and legacy `flows[]` if tooling still expects it).
8. **Scenarios** — write `scenarios[]` tied to invariants and permissions.
9. **UX surfaces** — optional `screens[]` tied to workflow steps; brownfield: `status: existing` + `source`.
10. **Implement brief** — write `implement.md`; set `status: ready_to_build`.
11. Write `report.md`; validate run if validator available.
12. **STOP** — tell user to implement with any stack, then `/lamina-verify`.

## Subagent hints

- **Fresh context:** large repo reads → [fresh-context](../patterns/fresh-context.md)
- **Parallel review:** accessibility + risks when supported
- Default: inline sequential
- **No** mid-design persona panel, blueprint studio, or artifact packs
