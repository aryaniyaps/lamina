# Minimum sufficient product graph

Use `run.json` as the canonical contract and treat `run.md` and `implement.md` as generated views.

## Depth

- `spark`: capture the critical promise, actors, consequential unknowns, and smallest testable behavior.
- `shape`: add the entities, operations, workflows, rules, dependencies, and distinct risks required to build the next iteration.
- `harden`: add complete lifecycle, permissions, concurrency, recovery, accessibility, and regression behavior for a trusted release.

Increase depth because of implementation risk, not because fields exist in the schema. Mark non-current behavior `deferred`; generated implementation views omit it.

## Node metadata

Every ready graph node declares `criticality`, `source`, `confidence`, and `relevance_reason`. These fields prevent speculative breadth from looking like confirmed product intent.

## References

Use typed references such as `actor.member`, `entity.invitation`, `operation.accept-invite`, and `workflow.join-household`. Keep references stable when names change.

## Scenario derivation

Derive one scenario per distinct risk. Start with unmet dependencies, declared operation failures, destructive actions, authority boundaries, concurrency, and recovery. Reuse an existing `risk_key` instead of duplicating equivalent cases.

## Ready gate

A graph is ready only when critical promises trace to critical actors, entities, operations, workflows, invariants, and scenarios; blocking policy forks are resolved; references and state transitions validate; and persona findings remain explicitly labeled simulations.
