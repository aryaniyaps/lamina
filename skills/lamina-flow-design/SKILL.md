---
name: lamina-flow-design
description: "Workflow design — multi-step journeys over domain operations with minimal excise. Use when defining workflows[] and screen sequences in run.yaml."
metadata:
  lamina:
    id: flow-design
    problems:
      - "multi-step workflow design"
      - "reducing excise and manipulative work"
      - "orchestrating user flows"
    related:
      - lamina-product-behavior
      - lamina-forms
      - lamina-task-analysis
    tags:
      - audit-default
---
# Flow Design (agent-native)

Define **`workflows[]`** as goal-directed operation sequences — classify each step as serving the actor's end goal or as excise to eliminate.

## Contract encoding

```yaml
workflows:
  - id: download-ticket
    actor: student
    steps:
      - operation: open ticket page
      - operation: download pdf
        guards: [payment_confirmed, window_open]
```

Link each step to `screens[]` and `scenarios[]` for non-happy paths.

## Frameworks

- **Goal-directed vs excise**: Navigational, manipulative, modality, and visual excise — cut or relocate to settings.
- **Effortlessness**: Count operations from intent to outcome on primary actor path.
- **Orchestration**: Steps cohere toward one workflow goal; modeless feedback over blocking dialogs.
- **Input where output is**: Edit in context; avoid separate admin screens for routine fixes.

## Design checklists

1. Primary actor can complete workflow without training (verify via actor walk).
2. No dialog reports normalcy — status is modeless.
3. Frequent workflows ≤ few steps; rare paths may use progressive disclosure (`platform-posture`).
4. Every mutating step has linked permission and failure scenarios.
5. Async steps declare feedback pattern in screen spec (`feedback-and-status`).

## Verify checks

- Actor walk each `workflows[]` entry on live product.
- Measure excise: extra clicks/modals vs contract intent.
- Parallel actors on shared workflows (`persuasion-and-groups`).

## Anti-patterns

- Workflow mirroring org chart or database tables.
- Confirmation dialogs for routine, undoable actions.
- Deep navigation for daily tasks.
- Happy-path-only `workflows[]` without scenario coverage.

## Related

- [Product Behavior](../lamina-product-behavior/SKILL.md)
- [Task Analysis](../lamina-task-analysis/SKILL.md)
- [Edge Cases](../lamina-edge-cases/SKILL.md)
