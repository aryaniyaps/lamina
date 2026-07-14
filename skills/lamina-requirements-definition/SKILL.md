---
name: lamina-requirements-definition
description: "Behavioral acceptance — scenarios and operations as testable criteria in run.yaml and implement.md. Not narrative screenplay handoffs."
metadata:
  lamina:
    id: requirements-definition
    problems:
      - "acceptance criteria"
      - "testable requirements"
    related:
      - lamina-orchestrator/artifacts
      - lamina-verify
      - lamina-edge-cases
---
# Behavioral Acceptance (agent-native)

Requirements live in **`run.yaml` + `implement.md`** — each scenario is verify-ready acceptance criteria.

## Mapping

| Artifact | Requirement form |
|----------|------------------|
| `domain.dependencies[]` | **First-class reachability** — mode + unmet acceptance via scenarios |
| `workflows[]` | Ordered operations with `requires` / `standalone` / `provides` |
| `scenarios[]` | Given/when/then with actor + data state; `dependency_ref` / `invariant_ref`; required **`acceptance`** |
| `actors[].resource_filters` | Ownership/privacy filters — fields must exist on entities |
| `invariants[]` | Must always hold — verify probes |
| `seed` / `out_of_scope` / `forbidden_content` | Fixture world + brief bans |
| `implement.md` | Ship pack — **Reachability graph** + scenarios→acceptance + done-when |

No separate requirements doc that drifts from contract.

## Acceptance rule

`scenarios[].acceptance` must be observable in the product (API status/body, UI copy/state, filtered field absent). Reject “handle gracefully.”

## Anti-patterns

- **Screenplay handoff** — narrative user stories without scenarios
- **Duplicate spec** — PRD parallel to `run.yaml`
- **Vibe acceptance** — non-observable pass conditions

## Related

- [Artifacts](../lamina-orchestrator/artifacts.md)
- [Verify](../lamina-verify/SKILL.md)
