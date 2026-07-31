# empty states

> Migrated intact from `skills/lamina-empty-states/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Empty States (agent-native)

Empty domain state is a **`scenarios[]` category `empty`** — not an afterthought in implementation.

## Contract encoding

```yaml
scenarios:
  - id: no-tickets-yet
    category: empty
    trigger:
      when: collection_empty
      entity: hall_ticket
    screen_id: ticket-list
    ux: empty_state
    primary_action: view exam schedule
    copy: No tickets yet — tickets appear after payment confirms.
```

## Design checklists

1. Every list/dashboard screen has `collection_empty` scenario or explicit "always populated" invariant.
2. One primary CTA toward first productive workflow step.
3. Explain what will appear after actor acts — not just "no data".
4. Distinguish empty vs error vs loading in `ux` field.
5. No fake data without label.

## Verify checks

- Actor walk with zero-data fixture or fresh account.
- Empty state copy matches contract; CTA completes onboarding workflow.

## Anti-patterns

- Bare table with no rows and no guidance.
- Feature tour modal instead of one clear action.
- Empty state missing from contract — implementer guesses.

## Related

- Onboarding
- Content Design
- Edge Cases
