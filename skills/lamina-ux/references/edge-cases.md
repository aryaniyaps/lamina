# Distinct product risks

Use Scenario Resources for observable behavior that differs from the primary
path. One Scenario represents one distinct risk; reuse its risk-classification
Statement rather than multiplying equivalent cases across Actors and Surfaces.

Prioritize:

- Declared operation failures.
- Unmet dependencies.
- Forbidden authority or ownership.
- Invalid and stale transitions.
- Concurrent consequential mutations.
- Destructive confirmation and recovery.
- External failure that changes product behavior.

Every scenario declares `given[]`, `when.operation_ref`, `then[]`, `covers[]`, metadata, and a unique `risk_key`. Acceptance must be externally observable. “Handle gracefully” is not acceptance.

Query the workflow closure and add only missing distinct risk Statements. Persona preferences do not become Scenarios unless they reveal a structural, safety, or evidence-backed failure.
