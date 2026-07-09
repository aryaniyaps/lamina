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

There are no perfect solutions — only trade-offs. Name them in product language before committing to rules, workflows, or guarantees.

## Decision frameworks

- **Trade-off articulation**: Every significant choice optimizes some properties at the expense of others (strict ticket rules vs flexible admin overrides; instant download vs payment verification delay).
  - When to use: Any non-obvious design decision.
  - How: Document context, choice, consequences, and rejected alternatives in `decisions.md` or run narrative.

- **Operational vs analytical paths**: Live user actions vs reporting/aggregates — often different freshness and correctness needs.
  - When to use: Products with dashboards and live flows sharing data.
  - How: Separate guarantees per path in `domain`.

- **Reversibility**: Prefer choices you can undo until the cost of delay exceeds the cost of change.
  - When to use: Uncertain requirements, greenfield features.

## Checklists

1. State the trade-off before the mechanism ("we choose X because Y at cost of Z").
2. Link trade-offs to primary actor and business outcome.
3. Avoid false "best practice" — match guarantee to actual user risk.
4. Record material trade-offs in global `decisions.md` with `run_id`.

## Heuristics

- **Name it before you build it**: Teams fight when trade-offs were never explicit.
- **Primary user filter**: When actors disagree, whose outcome matters most for this decision?

## Anti-patterns

- **Solution-first**: Picking a workflow because it is familiar, not because trade-offs were weighed.
- **Hidden costs**: Flexible overrides that erode invariants over time.

## Examples

- **Ticket availability**: Trade-off — strict 48h window (fairness, less support) vs anytime download (convenience, more invalid attempts). Document choice and scenarios for violations.

## Related capabilities

- [Leverage Points](../lamina-leverage-points/SKILL.md)
- [Decision Making](../lamina-decision-making/SKILL.md)
- [Evolutionary Rules](../lamina-evolutionary-rules/SKILL.md)
