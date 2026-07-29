# ADR-007: Gate graphd reuse on protocol capabilities

## Status

Accepted

## Date

2026-07-29

## Context

CLI 0.1.12 required `source_key_count` from `observation.status`, but an older
graphd process could survive the upgrade because both processes advertised
protocol 3. The old response omitted that field, so a correct observation view
was reported as incomplete. Rebuilding observations could not change the
daemon's response contract.

## Decision

Graph protocol 4 makes the complete observation-status shape explicit. graphd
publishes its runtime version and capabilities in its lock and `ping` response.
The client reuses a daemon only when its protocol and every required capability
match; otherwise it replaces the process without rewriting `graph.lbdb`.

Observation completion validates the response shape, requested generation,
active source-key count, and current source revision as named checks. A
malformed status triggers one daemon replacement and one observer retry.
Observation generation invalidation remains an explicit rebuild operation for
genuinely incomplete or corrupted target state.

## Consequences

In-place CLI upgrades preserve canonical Product, Persona, Actor, and
GraphVersion state while transparently replacing incompatible runtime
processes. Failures identify contract, generation, count, revision, and worker
conditions separately. Repeated rebuilds are no longer presented as a remedy
for runtime-version skew.
