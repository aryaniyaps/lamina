# forms

> Migrated intact from `skills/lamina-forms/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Forms (agent-native)

Specify **how data entry behaves** in the transactional graph — field semantics, validation timing, and recovery — not CSS or component libraries.

## Contract encoding

| Concern | Where |
|---------|--------|
| Fields per screen | `surfaces[].fields[]` or workflow step notes |
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
6. Classify date/time fields before choosing a control. A `datetime-local` value has no zone: submit its untouched local components plus the subject/place IANA zone for trusted resolution. Never convert it in the browser and attach another zone afterward.
7. Invalid DST-gap times preserve input and offer a nearby valid choice; ambiguous overlap times require an explicit earlier/later choice. Show the relevant zone when actors may differ.

## Verify checks

- Actor walk: submit invalid/partial data — observe recovery UX matches scenarios.
- Actor walk: required-for-invariant fields block with clear `ux` (banner/alert).
- A11y: labels associated with inputs on captured walkthrough steps.
- Temporal: run the form with browser zone different from subject zone and cover applicable DST gap/overlap recovery.

## Anti-patterns

- Keystroke rejection modals for recoverable typos.
- Clearing form on error without scenario documenting it.
- Free-text where bounded selection prevents inconsistency.
- Form spec that mirrors implementation model instead of actor mental model.

## Related

- Error Handling
- Flow Design
- Controls And Menus
