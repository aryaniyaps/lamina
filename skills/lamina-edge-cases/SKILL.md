---
name: lamina-edge-cases
description: "Scenario mapping for invariant violations, permissions, conflicts, and recovery UX. Use when mapping operational outcomes to run.yaml scenarios."
metadata:
  lamina:
    id: edge-cases
    problems:
      - "edge case mapping"
      - "invariant violation UX"
      - "permission and conflict scenarios"
      - "operational failure states"
    related:
      - lamina-invariants
      - lamina-dependencies
      - lamina-error-handling
      - lamina-empty-states
      - lamina-feedback-and-status
      - lamina-flow-design
      - lamina-idempotency-concurrency
    tags:
      - design-default
---
# Edge Cases (agent-native)

Map operations to **scenarios** in `run.yaml` — permission denials, conflicts, illegal transitions, empty domain states, unmet dependencies, and recovery UX.

**Guardrail:** Actor vocabulary only in contract. No SQL, ORM, or framework terms in `run.yaml`.

## When to use

- `/lamina-design` scenarios section (after dependency pass)
- `/lamina-verify` when live product reveals gaps
- Any mutating workflow missing non-happy outcomes

## Procedure

1. Read `domain` (including `dependencies[]`), `workflows`, `screens[]`, repo `source` paths
2. Per workflow step, list mutating operations and data shown
3. For each `domain.dependencies[]` edge, ensure a scenario with `dependency_ref` and `when: dependency_unmet`
4. Fill outcome matrix (below) — each row → scenario or explicit N/A with rationale
5. Link to `invariant_ref` where applicable
6. Verify: probe each scenario on live product

## Outcome matrix

| Outcome | Category | `trigger.when` | Typical `ux` |
|---------|----------|----------------|--------------|
| Nothing to show | `empty` | `collection_empty` | `empty_state` |
| Resource missing | `empty` | `not_found` | `empty_state` |
| Illegal state | `precondition` | `state_disallows` | `alert` or disabled action |
| Unreachable dependency | `precondition` | `dependency_unmet` | `alert`, disabled action, or `redirect` |
| Incomplete data | `partial` | `validation_failed` | `banner` |
| Concurrent edit | `conflict` | `concurrent_edit` | `error_state` |
| System failure | `failure` | `validation_failed` or `timeout` | `error_state` |
| Not allowed | `permission` | `forbidden` | `redirect` or denial |
| External down | `external` | `dependency_unavailable` | `banner` |
| At limit | `boundary` | `limit_reached` | `alert` |

## Checklists

1. Every mutating operation has permission + failure outcomes considered.
2. Every `domain.dependencies[]` edge has a linked scenario or explicit N/A.
3. Link scenarios to `domain.invariants` via `invariant_ref` when applicable.
4. Link unmet-dependency scenarios via `dependency_ref`.
5. Each scenario has required fields in `run.yaml` `scenarios[]`.
6. Recovery UX names what the actor should do next.

## Anti-patterns

- **UI-only brainstorming** without tying to domain operations or dependency graph.
- **Orphan scenarios** missing operation or screen reference.
- **Happy-path-only** for mutating workflows.
- **Brainstorming edge cases before dependencies** — define the graph first.

## Related capabilities

- [Dependencies](../lamina-dependencies/SKILL.md)
- [Invariants](../lamina-invariants/SKILL.md)
- [Error Handling](../lamina-error-handling/SKILL.md)
- [Empty States](../lamina-empty-states/SKILL.md)
