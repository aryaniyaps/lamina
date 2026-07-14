---
name: lamina-dependencies
description: "First-class reachability graph — domain.dependencies[] so unmet prerequisites are unreachable, degraded, blocked, or recovered before ship. Use when defining dependency edges and workflow requires."
metadata:
  lamina:
    id: dependencies
    problems:
      - "feature dependency graph"
      - "unreachable prerequisite states"
      - "degraded vs blocked reachability"
      - "cross-feature setup order"
      - "booking without setup edge cases"
    related:
      - lamina-system-structure
      - lamina-flow-design
      - lamina-edge-cases
      - lamina-invariants
    tags:
      - design-default
---
# Dependencies (agent-native)

**First-class contract feature.** `domain.dependencies[]` is the reachability graph that prevents most unusable product states. If feature A depends on B and B is unmet, A must not silently succeed.

**Kate rule:** Unmet prerequisites are failures of the product (or explicit degraded modes) — never surprise edge cases discovered at verify.

**Guardrail:** Actor vocabulary only. No SQL, ORM, or framework terms in `run.yaml`.

## When to use

- `/lamina-design` after entities and workflows exist, **before** scenarios (then link scenarios back)
- `/lamina-verify` reachability probes (live or static source)
- Any workflow that assumes prior setup, linked state, or another workflow’s outcome

## Why this is first-class

Most “broken UX” is a **reachability bug**: weekly review with failed sync, checkout without live inventory, partner ledger without household membership, download without payment. Invariants say what must stay true; **dependencies say what must be true before a journey can succeed** — and what the actor still can do when it is not.

| Concept | Question |
|---------|----------|
| **Invariant** | What must always hold in a valid state? |
| **Dependency** | What must be reachable before this workflow succeeds — and how does the product behave when it is not? |

## Contract encoding

```yaml
domain:
  entities:
    - id: account
    - id: payment
  dependencies:
    # Hard gate — workflow cannot proceed
    - id: download-requires-payment
      from: workflow.download-ticket
      requires: entity.payment
      in_state: confirmed
      mode: unreachable
      scenario_ref: payment-not-confirmed

    # Soft gate — workflow stays usable with reduced fidelity
    - id: weekly-review-with-stale-ok
      from: workflow.weekly-review
      requires: entity.account
      in_state: linked
      mode: degraded
      degraded_surfaces: [weekly-review, sync-status]
      recovery: workflow.account-linking
      scenario_ref: weekly-review-after-sync-fail

    # Blocked in UI with an explicit recovery path
    - id: book-requires-live-property
      from: workflow.traveler-book-and-pay
      requires: entity.property
      in_state: live
      mode: blocked_ui
      recovery: workflow.traveler-discover-and-search
      scenario_ref: property-not-live

workflows:
  - id: account-linking
    standalone: true                    # root setup — no requires
    provides: [entity.account]          # informs build order
    steps:
      - operation: link account

  - id: weekly-review
    requires: [weekly-review-with-stale-ok]
    success: "Weekly aggregates for active budget"
    degraded: "Last-known aggregates + sync-failure alert + Retry"
    failure: "Blocked only if no household/budget exists"
    steps:
      - operation: open weekly review

  - id: download-ticket
    requires: [download-requires-payment]
    steps:
      - operation: download pdf

scenarios:
  - id: weekly-review-after-sync-fail
    title: Review reachable after sync failure
    screen: weekly-review
    category: degraded
    ux: degraded_view
    trigger:
      operation: open weekly review
      subject: account
      when: dependency_unmet
    dependency_ref: weekly-review-with-stale-ok
    acceptance: >
      Weekly review loads with last-known aggregates; sync-failure alert visible;
      Retry control present; not an empty dead-end
```

### Field reference

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Stable id for `workflows[].requires` and `scenarios[].dependency_ref` |
| `from` | yes | `workflow.<id>` (preferred) or `entity.<id>` that fails when unmet |
| `requires` | yes | Prerequisite: `entity.<id>`, `workflow.<id>`, or `actor.<id>` |
| `in_state` | no | Required state on the prerequisite |
| `mode` | yes | `unreachable` \| `degraded` \| `blocked_ui` \| `recover` (legacy alias: `failure`) |
| `degraded_surfaces` | if `mode=degraded` | Screen ids still available under degradation |
| `recovery` | if `blocked_ui` or `recover` | `workflow.<id>` or `screen.<id>` the actor should take |
| `scenario_ref` | ready_to_build | Scenario that proves unmet behavior (also link via `dependency_ref`) |

### Modes (choose deliberately)

| Mode | Product behavior when unmet | Typical UX |
|------|-----------------------------|------------|
| `unreachable` | Operation cannot complete; no partial success | Hide/disable primary action; denial |
| `degraded` | Primary surface still opens; fidelity reduced | Banner + last-known data + retry |
| `blocked_ui` | Entry blocked with explanation | Redirect/gate to recovery |
| `recover` | Guided repair path before retry | Wizard / link account / pay first |

**Anti-pattern:** Defaulting everything to `unreachable` when the product should stay usable (sync fail → weekly review). **Anti-pattern:** Defaulting to `degraded` when money/inventory must not proceed (`unreachable` / `blocked_ui`).

## Procedure (design)

1. List entities + mutating workflows.
2. For each workflow, ask: **what must already exist or be in a valid state?** Emit one dependency edge per prerequisite — not prose.
3. Choose **mode** per edge (unreachable vs degraded vs blocked/recover).
4. Set `workflows[].requires: [<dependency_id>, ...]`. Mark true roots `standalone: true` and optional `provides: [entity.x]`.
5. Declare workflow `success` / `degraded` / `failure` outcomes when mode includes degraded.
6. For each edge, add `scenarios[]` with `dependency_ref`, `trigger.when: dependency_unmet`, and **observable `acceptance`**. Set `scenario_ref` on the edge.
7. Derive **build order** for `implement.md` from the graph (`provides` → dependents). Run `node lib/validate-run.mjs`.

## Procedure (verify)

1. For each `domain.dependencies[]` edge, put the product in the unmet state (live or seed/fixtures).
2. Attempt the `from` workflow.
3. Assert linked scenario `acceptance` — mode must match (no silent happy path).
4. Silent continuation when unmet → `findings[]` `fix_target: product`.
5. Observed gate missing from contract → `findings[]` `fix_target: contract`.

## Checklists

1. Every non-`standalone` workflow has `requires` when a graph exists.
2. No free-text `workflows[].preconditions` or freestyle `edge_cases` as substitutes.
3. Every dependency edge has scenario coverage (`dependency_unmet` + `acceptance`).
4. `degraded` edges name `degraded_surfaces`; `blocked_ui`/`recover` name `recovery`.
5. `implement.md` includes **Reachability graph** (build order + unmet behavior per edge).
6. Verify probes every edge — not only invariant violations.

## Anti-patterns

- **Prose preconditions** — `"property live"` bullets instead of graph edges.
- **Opaque guards** — `guards: [payment_confirmed]` for cross-feature reachability.
- **Edge-case brainstorming without graph** — failures without `requires`.
- **Orphan dependencies** — edges not referenced by any `workflows[].requires`.
- **Stack in the graph** — naming Auth0/FCM/AWS as dependencies (ops; put in `out_of_scope`).
- **Unusable silent states** — sync fail opens an empty review with no acceptance.

## Related capabilities

- [System Structure](../lamina-system-structure/SKILL.md)
- [Flow Design](../lamina-flow-design/SKILL.md)
- [Edge Cases](../lamina-edge-cases/SKILL.md)
- [Invariants](../lamina-invariants/SKILL.md)
- [Artifacts](../lamina-orchestrator/artifacts.md)
