---
name: lamina-tradeoffs
description: "Explicit product and system trade-offs — name what you gain and lose before choosing mechanisms. Use when comparing rules, guarantees, or workflow options."
metadata:
  lamina:
    id: tradeoffs
    problems:
      - "architecture and product trade-offs"
      - "choosing between consistency and availability in product terms"
      - "scope vs correctness debates"
    related:
      - lamina-leverage-points
      - lamina-decision-making
      - lamina-evolutionary-rules
    tags:
      - design-default
---
# Tradeoffs

There are no perfect solutions — only trade-offs. Name them in product language before committing to rules, workflows, or guarantees — then encode them as **`tradeoffs[]` in `run.yaml`**.

## Machine contract

```yaml
tradeoffs:
  - id: <concern_a>_vs_<concern_b>
    choice: <chosen product behavior from the current brief/context>
    cost: <what the choice makes harder>
    surfaces: [<workflow-or-screen-that-realizes-choice-and-mitigation>]
```

**Id rules:**
1. Derive the id from the current brief and product context only.
2. Preserve brief terminology when it explicitly names the tension; never consult or anticipate evaluator identifiers.
3. Each trade-off must ship both the `choice` and the mitigating surface implied by `cost`.

Also record material decisions in global `decisions.md` with `run_id` when debate warrants narrative.

## Decision frameworks

- **Trade-off articulation**: Every significant choice optimizes some properties at the expense of others.
- **Operational vs analytical paths**: Live actions vs reporting — different freshness/correctness.
- **Reversibility**: Prefer undoable choices until delay costs more than change.

## Checklists

1. State the trade-off before the mechanism ("we choose X because Y at cost of Z").
2. Write `tradeoffs[]` with stable `id`, `choice`, `cost`, and `surfaces`.
3. Link to primary actor and business outcome.
4. Implement.md Must-implement includes every `tradeoff.*` id; verify probes the mitigating control.

## Anti-patterns

- **Solution-first**: Familiar workflow without named trade-offs.
- **Hidden costs**: Overrides that erode invariants.
- **Synonym ids**: Renaming brief trade-off names so phrase checks and handoffs diverge.

## Related capabilities

- [Leverage Points](../lamina-leverage-points/SKILL.md)
- [Decision Making](../lamina-decision-making/SKILL.md)
- [Evolutionary Rules](../lamina-evolutionary-rules/SKILL.md)
