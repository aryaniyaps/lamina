# Error Handling (agent-native)

Every distinct failure mode gets a **Scenario Resource** with actor-visible
recovery Statements—never blame the actor in copy or findings.

## Contract encoding

Example: create a `venue-conflict` Scenario Resource, classify it as
`conflict`, link it to the Assign Venue Operation, and add typed trigger
`concurrent_edit`, visible state `error`, and recovery `refresh and retry; show
who holds lock` Statements.

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
