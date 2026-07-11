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
| `domain.dependencies[]` | Reachability edges — what must exist before a workflow succeeds |
| `workflows[]` | Ordered operations with `requires` refs to dependency ids |
| `scenarios[]` | Given/when/then with actor + data state; `dependency_ref` for unmet deps |
| `invariants[]` | Must always hold — verify probes |
| `implement.md` | Build checklist + setup order derived from dependency graph |

No separate requirements doc that drifts from contract.

## Anti-patterns

- **Screenplay handoff** — narrative user stories without scenarios
- **Duplicate spec** — PRD parallel to `run.yaml`

## Related

- [Artifacts](../lamina-orchestrator/artifacts.md)
- [Verify](../lamina-verify/SKILL.md)
