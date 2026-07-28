# ADR-001: Use a clone-local transactional product graph

## Status

Accepted

## Date

2026-07-27

## Context

Lamina previously treated `.lamina/runs/*/run.json` as the canonical product
contract. Agents could materialize and rewrite the whole document, while
generated Markdown and persona files carried overlapping product state. That
made concurrent work vulnerable to lost updates and made provenance,
contradictions, branch lineage, and execution evidence difficult to enforce.

The replacement must preserve:

- typed product knowledge and open product taxonomies;
- atomic multi-mutation changes with optimistic concurrency;
- automatic deterministic validation without a human approval step;
- explicit provenance and epistemic separation;
- conflicting knowledge without silent winner selection;
- Git branch and worktree isolation inside one clone;
- incremental brownfield observations;
- independently executed Persona Missions and reproducible evidence; and
- a hard cutover with no legacy dual-write path.

The design should remain local and minimal. Cross-clone synchronization,
distributed consensus, arbitrary project validators, graph interoperability,
and semantic-search infrastructure are not required.

## Decision

LadybugDB is the only canonical product-knowledge store. One long-running
`graphd` process owns its read-write `Database` object and serves authenticated
clone-local requests over a Unix socket or Windows named pipe. All worktrees
share the database under the Git common directory.

The logical model uses generic immutable `Resource` and first-class
`Statement` records. `GraphVersion` records retain version deltas and active
membership. Branch, session, observation, and historical `GraphView` records
resolve those versions without creating a second truth-bearing store.

Agents stage typed Resource and Statement proposals in sessions. Publication
uses compare-and-swap, reconciles all Git parents, derives canonical
Contradictions for incompatible facts, validates the resulting affected graph,
and moves the branch head in one Ladybug transaction. Mechanical invalidity
rolls back. Valid knowledge with readiness gaps or epistemic conflicts remains
representable but is not approved.

Epistemic class and approval are engine-owned. Ingress, lineage, capability
manifest identity, evidence availability, and pinned validators determine
them; callers cannot label their own proposals as intended, observed, runtime,
human, or approved.

CocoIndex v1 owns only rebuildable incremental tracking and memoization. Its
custom target submits deterministic Observation upserts and tombstones through
graphd. It never opens Ladybug or writes intended product knowledge,
Contradictions, Decisions, Missions, Runs, or readiness.

Git identifies source revisions, branches, and merge parents. It does not store
or merge graph data. A deterministic logical backup is the v1 disaster-recovery
boundary. Large runtime artifacts live in a clone-local content-addressed
evidence directory and are referenced by digest.

Legacy `run.json` files are not imported, rewritten, or selected by production
commands. Human-readable implementation, verification, report, and fix
documents are non-canonical query projections stamped with GraphVersion and
source revision.

## Alternatives Considered

### Continue canonical `run.json`

- Simple to inspect and edit.
- Cannot make whole-document agent rewrites transactional or prevent lost
  updates without building a second mutation system around the file.
- Rejected because it preserves the failure mode the migration is intended to
  remove.

### Dual-write `run.json` and the graph

- Would provide a compatibility window.
- Creates two authorities and a cross-store commit protocol, while allowing old
  workflows to keep treating the legacy file as canonical.
- Rejected in favor of a hard cutover.

### Git-native change packs and graph merge drivers

- Could synchronize graph history across clones.
- Requires content-addressed journals, head files, merge drivers, and
  filesystem/database coordination before Lamina has a cross-clone requirement.
- Rejected for v1; GraphVersion history and backup remain sufficient locally.

### CocoIndex as the canonical knowledge store

- Already provides incremental source processing and target-state tracking.
- Its operational state is designed to be reconciled and rebuilt; it is not the
  authority for human intent, contradictions, Decisions, Missions, or Runs.
- Rejected. CocoIndex is limited to source-derived Observations.

### Multiple graph backends or RDF interoperability

- Could increase portability and standards integration.
- Expands the schema, query, validation, and migration surface without a
  present product requirement.
- Rejected for v1. The generic Resource/Statement model leaves room for later
  exports without weakening the single-store invariant.

## Consequences

- Every canonical write goes through graphd and a Ladybug transaction.
- Concurrent sessions and worktrees can fail safely with compare-and-swap and
  rebase instead of overwriting one another.
- Git merges create multi-parent GraphVersions; incompatible parent facts
  become first-class Contradictions.
- Observation caches and managed Python environments may be deleted and
  rebuilt without changing canonical claims.
- Separate clones do not share graph state automatically in v1.
- Database-format upgrades require explicit migration or backup/restore
  tooling.
- Legacy artifact consumers must migrate to graph queries and generated
  projections; there is no compatibility runtime.
- The public skill distribution boundary is specified separately in
  [ADR-003](./003-public-sibling-skills.md).
