# error handling

> Migrated intact from `skills/lamina-error-handling/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Error Handling (agent-native)

Every failure mode gets a **`scenarios[]` entry** with actor-visible recovery — never blame the actor in copy or findings.

## Contract encoding

```yaml
scenarios:
  - id: venue-conflict
    category: conflict
    trigger:
      operation: assign venue
      when: concurrent_edit
    ux: error_state
    recovery: refresh and retry; show who holds lock
```

| Error type | Design response |
|------------|-----------------|
| **Slip** (right goal, wrong execution) | Undo, constraints, immediate feedback |
| **Mistake** (wrong goal/plan) | Better signifiers, conceptual model in copy |

## Checklists

1. "Human error" is design failure until proven otherwise.
2. Preserve actor input on recoverable failures.
3. Message: what happened → why (plain language) → next action.
4. No error codes without human explanation.
5. Automation failures: actor kept informed (no silent mode switches).

## Verify checks

- Trigger each failure scenario on live product (actor walk or probe).
- Double-submit / race scenarios (`idempotency-concurrency`).
- Actor walk reports confusion at recovery step → finding.

## Anti-patterns

- Blame-the-user copy.
- Alert fatigue — warnings dismissed become slip enablers.
- Modal for recoverable batch errors.
- Training docs substituting for error-proofing.

## Related

- Edge Cases
- Forms
- Feedback And Status
