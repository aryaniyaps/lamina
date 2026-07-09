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
| `.lamina/runs/<run_id>/report.md` | Human narrative only |
| `.lamina/runs/<run_id>/walkthrough/` | Live-app evidence (verify / brownfield) |
| `.lamina/runs/<run_id>/evidence.md` | Optional evidence ledger |

**Removed:** blueprints, `preview-state.yaml`, `handoff.md` pipeline, artifact-catalog packs.

---

## Run lifecycle

### Design (`/lamina-design`)

1. Create `run.yaml` — `status: designing`, `hook: design`
2. Write `domain`, `actors` (or update `personas.yaml`), `workflows`, `scenarios`, optional `screens`
3. Set `status: ready_to_build`; write `implement.md`
4. Write `report.md` (narrative)

### Verify (`/lamina-verify`)

1. Load design run or infer domain from repo
2. Set `status: verifying`
3. Capture `walkthrough/` when `base_url` available
4. Run actor walks, a11y, invariant probes → `findings[]`
5. Set `status: complete` (or loop back with gaps in findings)

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

actors:
  - id: student
    permissions: [download_ticket]
  - id: exam_cell
    permissions: [assign_venue, regenerate_ticket]

workflows:
  - id: download-ticket
    steps: [check_payment, check_window, generate_or_show]

scenarios:
  - id: unpaid-blocked
    category: permission
    trigger:
      operation: download ticket
      when: precondition_failed
    invariant_ref: payment-confirmed

screens:
  - id: ticket-download
    status: new | existing
    source: null

findings: []   # verify phase

evidence: []
```

**Notes:**
- `domain` holds entities, relationships, states, transitions, invariants (user language).
- `actors` may reference `.lamina/personas.yaml` cast; permissions live here or in personas.
- `workflows` are user journeys over operations/states.
- `scenarios` cover invariant violations, permissions, conflicts, recovery UX.
- `screens` are structural UX surfaces tied to workflows — no styling.

---

## `implement.md`

Written when `status: ready_to_build`. Brief for external coding agent:

- What to build (workflows, screens)
- Invariants that must hold (ids from `domain`)
- Actors and permissions
- Scenarios to handle
- Explicit: any stack, any UI library

---

## Actor simulation (verify only)

One subagent per actor during `/lamina-verify` — not mid-design. See `patterns/visual-walkthrough.md` and verify workflow.

Load [lamina-user-modeling](../lamina-user-modeling/SKILL.md) for actor cast.

---

## Checkpoints

Removed: blueprint preview, UX Review Studio, artifact-pack subagents, mid-design persona panel.

Optional: clarify gate, continue-or-revise (human pacing only — skip for agent-primary flows).
