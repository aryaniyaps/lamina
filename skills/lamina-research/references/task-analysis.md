# Task Analysis (agent-native)

Decompose actor goals into **Operation Resources** — verbs on domain Entities —
linked into Workflow order and navigation structure.

## Procedure

1. From evidence-backed Persona goals, list Operations: "download ticket",
   "assign venue".
2. Group operations into workflows by outcome, not by backend module.
3. Rank **deal-breaker** operations — if blocked, actor abandons product.
4. Map working-set (daily) operations to shortest nav path in screen specs.
5. Rare operations → progressive disclosure (`platform-posture`).

## Contract encoding

- Workflow ordering = `lamina:hasStep` Statements with a `position` qualifier;
  dependency Statements capture prerequisites
- Task-analysis prose is optional in a GraphVersion report projection for
  complex domains
- Navigation labels = operation vocabulary, not org chart

## Design checklists

1. Nav structured by tasks, not implementation modules.
2. Index/wayfinding separated from work area on sovereign apps.
3. Key paths ≤ few steps for working-set tasks.
4. Edge tasks reachable but not prominent.
5. Each operation links to permission in `actors`.

## Verify checks

- Actor walk: deal-breaker operations completable on live product.
- Measure steps vs contract workflow length.

## Anti-patterns

- Org-chart or file-system navigation.
- Deep hierarchy for daily tasks.
- Operations in contract that no actor has permission to perform.
