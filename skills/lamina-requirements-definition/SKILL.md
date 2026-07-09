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
| `workflows[]` | Ordered operations with guards |
| `scenarios[]` | Given/when/then with actor + data state |
| `invariants[]` | Must always hold — verify probes |
| `implement.md` | Build checklist derived from above |

No separate requirements doc that drifts from contract.

## Anti-patterns

- **Screenplay handoff** — narrative user stories without scenarios
- **Duplicate spec** — PRD parallel to `run.yaml`

## Related

- [Artifacts](../lamina-orchestrator/artifacts.md)
- [Verify](../lamina-verify/SKILL.md)
