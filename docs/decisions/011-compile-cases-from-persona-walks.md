# ADR 011: Compile cases directly from Persona walks

- Status: Accepted
- Date: 2026-07-30
- Supersedes: ADR 009
- Amends: ADR 008 WorkMap details

## Context

The first Persona-first implementation introduced the right design activity
but retained three redundant representations:

1. an engine-recorded Persona simulation;
2. an agent-authored Experience Contract that copied the same nodes; and
3. a WorkMap that copied case steps, expected results, and verification
   artifacts already present in compiled Cases and Mission events.

The copies could disagree. The Experience Contract also turned graph assembly
into a second authoring phase after the independent walks. WorkMap mutation
during verification weakened its role as the pre-edit commitment.

Coverage digests were based mainly on Resource ids. Changes to permissions,
Resource data, or Statement qualifiers could therefore leave an old walk
looking current.

## Decision

Keep four abstractions because each owns a distinct invariant:

- Product graph Resources and Statements describe shared product structure.
- `persona_walk` Resources record independent Persona-specific design.
- WorkMaps bind graph requirements to repository files before editing.
- Missions record runtime proof after implementation.

Remove the authored Experience Contract. `graphd` validates one current
`lamina.persona-walk/v1` Resource per active Persona and compiles Experience
Cases directly from those walks. Every active product Persona walks every
Workflow; denied and inapplicable nodes are explicit, so a separate
Persona-to-Workflow relevance roster cannot hide a missing perspective.

The coverage digest now hashes canonical covered Resource data and relevant
Statements, not only membership ids. Recording a walk replaces that Persona's
previous active walk for the Workflow. Any covered product or relationship
change makes all old walks stale until rerun.

Each walk returns explicit discovery arrays for Personas, Actors, Operations,
Scenarios, Invariants, Surfaces, branches, and open decisions. A non-empty
array is an implementation-readiness gap. The parent must expand the graph and
rerun every Persona until a current round returns no discoveries. At each node,
the walk must cover both the canonical state matrix and every state declared on
the Operation or its Surfaces.

The prepared task exposes the coverage digest, not the full coverage snapshot.
It includes shared product and Actor facts plus only the selected Persona's
relationships, so one walker does not receive another Persona's record.

`lamina.work-map/v4` is an immutable requirement-to-file map. Each file entry
has:

- `action: modify | create`; and
- `role: implementation | test`.

`modify` must resolve to an existing regular file inside the repository.
`create` must be absent at check time, have an in-repository existing ancestor,
and exist as a regular file at verification. Changed obligations require an
implementation file; changed Experience Cases require a test file.

`lamina work map` mechanically scaffolds one unresolved row for every
ImplementationPacket obligation and Experience Case. The agent resolves status
and files but cannot silently omit or invent requirement identities.

WorkMap no longer repeats case fixtures, steps, expected results, or proof
artifacts. Cases already contain the behavioral oracle. Published Mission
events are the runtime evidence, so the separate
`lamina.experience-evidence/v1` manifest is removed. A passing oracle event
contains the case id and structured observation and references a reproducible
artifact.

WorkStarted stores the one canonical checked WorkMap snapshot. WorkVerified
does not copy it again; it references the WorkStarted receipt and the same map
digest.

The hard cutover uses ImplementationPacket, WorkMap, WorkStarted, and
WorkVerified v4 only. Older packet and map schemas are rejected.

## Alternatives considered

### Keep a mechanically generated Experience Contract

Rejected. A materialized copy would still need invalidation and identity rules
while adding no authority beyond the current walk set and deterministic
compiler.

### Store Persona findings only as shared graph Statements

Rejected. Shared Statements cannot preserve the independent per-Persona path,
denied nodes, and coverage matrix that the compiler needs.

### Let WorkMap accumulate verification results

Rejected. A mutable map combines planning and evidence and allows the checked
implementation scope to drift. WorkStarted now binds the entire map digest.

### Preserve old schemas

Rejected. Compatibility branches had become a second workflow with weaker
invariants. The user explicitly allowed breaking changes.

## Consequences

- There is one authored representation of each Persona path.
- Product or permission edits invalidate walks even when Resource ids remain
  unchanged.
- The graph can expose simulated reasoning without pretending it is runtime
  evidence.
- WorkMap is smaller and mechanically checkable.
- Runtime approval depends on published Missions, not standalone map files.
- Existing users must prepare fresh v4 packets and maps.
- Providers still own actual subagent isolation; graphd binds the task,
  isolation reference, coverage, and result but cannot cryptographically
  identify a provider process.
