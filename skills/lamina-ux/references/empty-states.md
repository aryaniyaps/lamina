# Empty States (agent-native)

Empty domain state is a **Scenario Resource classified as `empty`**—not an
afterthought in implementation.

## Contract encoding

Example: create a `no-tickets-yet` Scenario Resource and link it to the Hall
Ticket Entity and ticket-list Surface. Add classification `empty`, trigger
`collection_empty`, primary Operation `view exam schedule`, and the visible
copy as typed Statements.

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
