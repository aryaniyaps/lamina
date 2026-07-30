# ADR 010: Make graph acknowledgements durable across process loss

- Status: Accepted
- Date: 2026-07-30

## Context

A long-running Prescription Tracker graph accumulated zero-byte JSON Resource
payloads after checkpoint and WAL failures in the embedded Ladybug runtime.
The graph daemon had already acknowledged the affected writes, so callers had
no reason to retry them. Later graph reads failed with `Unexpected end of JSON
input`, and restoring the backup reproduced the problem when the restored data
remained dependent on WAL replay.

LadybugDB 0.19.0 fixes checkpoint consistency, checkpoint-lock cleanup, and
torn-WAL recovery. The graph service still needs an application-level contract
for operations whose success responses promise durable graph state.

## Decision

Lamina uses LadybugDB 0.19.0 and explicitly checkpoints before acknowledging:

- observation batch application;
- observation invalidation; and
- full graph restore.

Session publication already checkpoints before returning success and remains
covered by the same durability test suite. Tests now exercise large JSON
payload sets, close and reopen, restore without residual WAL state, and daemon
recovery after an immediate `SIGKILL`.

Daemon reuse also requires an exact CLI runtime-version match in addition to
the graph protocol and capability checks from ADR 007. This lets a storage
runtime fix replace an already-running older daemon even when the wire contract
has not changed.

Read-heavy validation and work-context compilation use bounded batch snapshots
instead of one Ladybug query per Resource, Statement, or evidence edge. This
reduces checkpoint pressure and makes recovery validation practical on larger
graphs without changing graph authority or result semantics.

## Consequences

- A successful durable-write response no longer depends on later WAL replay.
- CLI upgrades transparently recycle older graph daemons while preserving the
  canonical database.
- Large graph restore and context compilation avoid pathological query counts.
- Checkpointing adds bounded latency to acknowledged write batches in exchange
  for a stronger durability guarantee.
- Wire-compatible CLI releases no longer share graph daemon processes across
  runtime versions.
