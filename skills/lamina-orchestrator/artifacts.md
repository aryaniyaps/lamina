# Lamina Artifacts

**Guardrail:** Write only under `.lamina/`. Never edit app source.

Always preserve `.lamina/` outputs between runs and reuse existing artifacts before regenerating.

---

## Artifact model

### Global

| Path | Purpose |
|------|---------|
| `.lamina/business-context.md` | Domain charter from `/lamina-init` |
| `.lamina/personas.yaml` | Actors — roles, goals, permissions, constraints |
| `.lamina/decisions.md` | Conflict resolution log with `run_id` refs |

### Per-run

| Path | Purpose |
|------|---------|
| `.lamina/runs/<run_id>/run.yaml` | **Machine contract** — domain, actors, workflows, scenarios, screens, findings |
| `.lamina/runs/<run_id>/implement.md` | Stack-agnostic build brief at `ready_to_build` |
| `.lamina/runs/<run_id>/fix.md` | Post-verify product fix brief (coding session handoff) |
| `.lamina/runs/<run_id>/report.md` | Human narrative only |
| `.lamina/runs/<run_id>/walkthrough/` | Live-app evidence (verify / brownfield) |
| `.lamina/runs/<run_id>/evidence.md` | Optional evidence ledger |

**Removed:** blueprints, `preview-state.yaml`, `handoff.md` pipeline, artifact-catalog packs. Post-verify handoff uses `fix.md` instead.

---

## Run lifecycle

### Design (`/lamina-design`)

1. Create `run.yaml` — `status: designing`, `hook: design`
2. Write `domain` (entities, invariants, `dependencies`), `actors` (or update `personas.yaml`), `workflows`, `scenarios`, optional `screens`
3. Set `status: ready_to_build`; write `implement.md`
4. Write `report.md` (narrative)

### Verify (`/lamina-verify`)

1. Load design run or infer domain from repo
2. Set `status: verifying`
3. Capture `walkthrough/` when `base_url` available
4. Run actor walks, a11y, invariant probes, reachability probes → `findings[]` with `fix_target` per finding
5. Set `status: complete` (or loop back with gaps in findings)
6. Write `report.md` and `fix.md`

Validate: `node lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml` (or import from `lib/run.mjs` in tests).

---

## `run.yaml` schema

```yaml
id: hall-ticket-2026-07-09
status: designing | ready_to_build | verifying | complete
hook: design | verify
target: hall ticket download
command: /lamina-design
started_at: 2026-07-09

domain:
  entities:
    - id: exam
      relationships: [venue, hall_ticket]
      states: [scheduled, completed]
      invariants:
        - id: one-ticket-per-student
          rule: At most one valid hall ticket per student per exam
  dependencies:
    - id: download-requires-payment
      from: workflow.download-ticket
      requires: entity.payment
      in_state: confirmed
      failure: unreachable

actors:
  - id: student
    permissions: [download_ticket]
  - id: exam_cell
    permissions: [assign_venue, regenerate_ticket]

workflows:
  - id: download-ticket
    requires: [download-requires-payment]
    steps:
      - operation: open ticket page
      - operation: download pdf
        invariant_ref: payment-confirmed

scenarios:
  - id: unpaid-blocked
    category: permission
    trigger:
      operation: download ticket
      when: forbidden
    invariant_ref: payment-confirmed
  - id: payment-not-confirmed
    category: precondition
    trigger:
      operation: download ticket
      when: dependency_unmet
    dependency_ref: download-requires-payment

screens:
  - id: ticket-download
    status: new | existing
    source: null

findings: []   # verify phase — each item may include fix_target: product | contract

evidence: []
```

**Notes:**
- `domain` holds entities, relationships, states, transitions, invariants, and `dependencies` (reachability graph).
- `domain.dependencies[]` is the single source of truth for cross-feature reachability. If feature A depends on B and B is unreachable, A is a failure — not an ad-hoc edge case.
- `workflows[].requires` lists `domain.dependencies[]` ids the workflow depends on. Do **not** use free-text `preconditions` lists.
- `actors` may reference `.lamina/personas.yaml` cast; permissions live here or in personas.
- `workflows` are user journeys over operations/states.
- `scenarios` cover invariant violations, unmet dependencies, permissions, conflicts, recovery UX.
- `screens` are structural UX surfaces tied to workflows — no styling.

---

## `implement.md`

Written when `status: ready_to_build`. Brief for external coding agent:

- What to build (workflows, screens)
- **Build/setup order** implied by `domain.dependencies[]` (e.g. property setup before booking)
- Invariants that must hold (ids from `domain`)
- Actors and permissions
- Scenarios to handle (including unmet-dependency failures via `dependency_ref`)
- Explicit: any stack, any UI library

Do not dump free-text precondition prose — reference dependency ids and invariant ids from the contract.

---

## `fix.md`

Written when verify completes with non-empty `findings[]`. Brief for external coding agent to fix the live product:

- **Product fixes** — prioritized from `findings[]` where `fix_target` is `product` or unset
- **Contract deltas** — findings with `fix_target: contract` → scoped `/lamina-design` prompts (not app code)
- Acceptance criteria per finding id
- Implementation session prompt and re-verify instruction

Supersedes the removed `handoff.md` pipeline for post-verify work.

## Actor simulation (verify only)

One subagent per actor during `/lamina-verify` — not mid-design. See `patterns/visual-walkthrough.md` and verify workflow.

Load [lamina-user-modeling](../lamina-user-modeling/SKILL.md) for actor cast.

---

## Checkpoints

Removed: blueprint preview, UX Review Studio, artifact-pack subagents, mid-design persona panel.

Optional: clarify gate, continue-or-revise (human pacing only — skip for agent-primary flows).
