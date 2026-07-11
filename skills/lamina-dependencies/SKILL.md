---
name: lamina-dependencies
description: "Feature and state reachability — explicit dependency graph so unreachable prerequisites surface as failures before ship. Use when defining domain.dependencies[] and workflow requires."
metadata:
  lamina:
    id: dependencies
    problems:
      - "feature dependency graph"
      - "unreachable prerequisite states"
      - "cross-feature reachability"
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

Define **reachability** in `run.yaml` — which features, entities, and states must exist before another workflow can succeed.

**Kate rule:** If feature A depends on feature B, and B is unreachable, A is a failure — not a surprise edge case discovered at verify.

**Guardrail:** Actor vocabulary only. No SQL, ORM, or framework terms in `run.yaml`.

## When to use

- `/lamina-design` after entities and workflows exist, **before** scenarios
- `/lamina-verify` reachability probes on live product
- Any workflow that assumes prior setup (property before booking, payment before download)

## Contract encoding

```yaml
domain:
  dependencies:
    - id: booking-requires-live-property
      from: workflow.traveler-book-and-pay
      requires: entity.property
      in_state: live
      failure: unreachable

workflows:
  - id: traveler-book-and-pay
    requires: [booking-requires-live-property]
    steps:
      - id: create-inventory-hold
        action: System creates hold
        invariant_ref: no-double-booking
```

### Field reference

| Field | Meaning |
|-------|---------|
| `id` | Stable reference for `workflows[].requires` and `scenarios[].dependency_ref` |
| `from` | Workflow or feature that fails when dependency unmet (`workflow.<id>` or `entity.<id>`) |
| `requires` | Prerequisite target (`entity.<id>`, `workflow.<id>`, or actor setup) |
| `in_state` | Required state on the prerequisite (omit when existence alone suffices) |
| `failure` | `unreachable` \| `blocked_ui` \| `recover` — how the product should behave |

## Procedure (design)

1. Read `domain.entities`, `workflows`, `actors.permissions`.
2. For each mutating workflow, ask: what must already exist or be in a valid state?
3. Emit `domain.dependencies[]` — one edge per prerequisite, not prose lists on the workflow.
4. Set `workflows[].requires: [<dependency_id>, ...]` on each dependent workflow.
5. For each edge, add a linked `scenarios[]` row with `dependency_ref` and `trigger.when: dependency_unmet`, or document explicit N/A.
6. Derive **build/setup order** for `implement.md` from the graph (topological order).

## Procedure (verify)

1. For each `domain.dependencies[]` edge, put the live product in the unmet-dependency state.
2. Attempt the `from` workflow — UI must **prevent**, **block**, or **recover** per `failure` and linked scenario.
3. Silent happy-path continuation when prerequisite is missing → `findings[]` with `fix_target: product`.
4. Missing edge in contract but failure observed → `findings[]` with `fix_target: contract`.

## Invariants vs dependencies

| Concept | Question it answers |
|---------|---------------------|
| **Invariant** | What predicate must always hold in a valid state? |
| **Dependency** | What must be reachable before this workflow can succeed? |

Use `invariant_ref` on steps for rules that must hold during execution. Use `domain.dependencies[]` for cross-feature setup and reachability.

## Checklists

1. Every mutating workflow with prerequisites declares `requires` when deps exist.
2. No free-text `workflows[].preconditions` — graph edges only.
3. Every dependency edge has a scenario or explicit N/A.
4. `implement.md` lists build order implied by the graph.
5. Verify probes cover unmet-dependency paths, not only invariant violations.

## Anti-patterns

- **Prose preconditions** — `"property live"` as a bullet list instead of a graph edge.
- **Opaque step guards** — string tokens like `guards: [payment_confirmed]` for cross-feature reachability; use `requires` + `dependency_ref` or `invariant_ref`.
- **Edge-case brainstorming without graph** — listing failures without defining what they depend on.
- **Orphan dependencies** — edges not referenced by any workflow `requires` or scenario.

## Related capabilities

- [System Structure](../lamina-system-structure/SKILL.md)
- [Flow Design](../lamina-flow-design/SKILL.md)
- [Edge Cases](../lamina-edge-cases/SKILL.md)
- [Invariants](../lamina-invariants/SKILL.md)
