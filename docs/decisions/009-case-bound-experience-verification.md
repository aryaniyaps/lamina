# ADR 009: Require case-bound experience verification for user-facing work

- Status: Accepted
- Date: 2026-07-30

## Context

The passive implementation contract introduced by ADR 008 made graph closure
and four UI audit classes mandatory, but it still admitted a false positive:
a workflow could be implementation-ready with generic operations, invariants,
scenarios, and proofs. A WorkMap could then point all obligations at broad
files, while identical `oracle_passed` events and audit artifacts appeared to
verify every Mission.

That structure did not force product authors or coding agents to decide common
experience semantics such as whether an input is optional, whether two roles
may share an identity, what a duplicate means, where a server rejection is
shown, what input is preserved, or how the user recovers. Visual coverage was
therefore stronger than behavioral coverage.

## Decision

Every graph-backed workflow with a Surface must link exactly one Decision via
`lamina:experienceContract`. Its value uses
`lamina.experience-contract/v1` and defines:

- actor inputs and requiredness;
- relationship identity, cardinality, duplicate, and self-reference policy;
- visible success, failure, and recovery behavior;
- concrete Surface states and field/error presentation;
- an executable attempt and expected result for every invariant.

The graph compiler validates that contract against the exact workflow closure
and deterministically compiles Experience Cases. Surface work is blocked when
the contract is missing, vague, or does not cover a reachable Scenario or
Invariant.

Implementation packets and maps advance to v2. Every Experience Case must have
explicit targets, fixtures, steps, expected observations, and verification.
Mission oracle events must name a compiled case and reference a structured
`lamina.experience-evidence/v1` manifest. Surface audit events must name a
Mission surface and concrete state. Work verification requires complete
published case and audit coverage.

The previous v1 packet and map remain readable only for workflows without a
Surface. This preserves compatibility for non-user-facing and historical
automation while preventing legacy acceptance from weakening live product UX.

## Consequences

- Product decisions that users experience become explicit before source edits.
- Generic pass events, screenshots, and all-files WorkMap rows can no longer
  stand in for input, relationship, failure, or recovery behavior.
- Case identifiers are reproducible from graph content and can be traced
  through packets, maps, Mission Runs, and evidence artifacts.
- UX review becomes a blocking product contract by default for user-facing
  work, not an optional styling phase.
- Existing surface graphs need one transactional design migration before new
  implementation work can proceed.
