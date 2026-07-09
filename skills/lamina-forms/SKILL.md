---
name: lamina-forms
description: "Form behavior in contracts — validation timing, field semantics, and recovery UX. Use when data entry blocks workflows or causes scenario gaps."
metadata:
  lamina:
    id: forms
    problems:
      - "designing data entry forms"
      - "validation blocking users"
      - "form abandonment and errors"
    related:
      - lamina-error-handling
      - lamina-flow-design
      - lamina-controls-and-menus
    tags:
      - audit-default
      - interaction
---
# Forms (agent-native)

Specify **how data entry behaves** in `run.yaml` — field semantics, validation timing, and recovery — not CSS or component libraries.

## Contract encoding

| Concern | Where |
|---------|--------|
| Fields per screen | `screens[].fields[]` or workflow step notes |
| Validation timing | scenario `trigger.when: validation_failed` |
| Recoverable vs blocking | scenario `category: partial` vs `failure` |
| Data immunity vs integrity | `decisions.md` + form policy in `implement.md` |

**Data immunity** (default for high-volume entry): accept input, flag uncertainty, audit later — never halt batch flow for recoverable format issues.

**Bounded controls**: match widget semantics to data type in screen spec; allow override when domain requires.

## Design checklists

1. Prefer immunity over keystroke-level rejection unless invariant requires hard stop.
2. Batch-review anomalies instead of modal-blocking each error.
3. Preserve entered data on validation failure (scenario + `implement.md`).
4. Required fields only when invariant or workflow depends on them.
5. Map each field to domain entity attribute — not database column names in user-facing copy.

## Verify checks

- Actor walk: submit invalid/partial data — observe recovery UX matches scenarios.
- Actor walk: required-for-invariant fields block with clear `ux` (banner/alert).
- A11y: labels associated with inputs on captured walkthrough steps.

## Anti-patterns

- Keystroke rejection modals for recoverable typos.
- Clearing form on error without scenario documenting it.
- Free-text where bounded selection prevents inconsistency.
- Form spec that mirrors implementation model instead of actor mental model.

## Related

- [Error Handling](../lamina-error-handling/SKILL.md)
- [Flow Design](../lamina-flow-design/SKILL.md)
- [Controls And Menus](../lamina-controls-and-menus/SKILL.md)
