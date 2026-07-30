# ADR 008: Compile passive implementation context from the product graph

- Status: Accepted; WorkMap details amended by ADR 011
- Date: 2026-07-29

## Context

Lamina previously installed product-design skills but still asked users to
invoke design and verification phases explicitly. Coding agents also received
human projections or broad graph query results without a machine-checkable
connection from each product requirement to code and proof. This let a useful
graph sit idle during ordinary implementation and allowed live UI verification
to pass without systematic visual, responsive, or accessibility evidence.

A coding agent does not need the largest possible context window. It needs a
decision-complete, bounded contract for the requested change: objective and
non-goals, actors and authority, ordered operations, states and outcomes,
invariants and failures, surfaces, proof oracles, code-localization candidates,
and the current evidence for each obligation.

## Decision

After the one explicit `/lamina-init`, provider-owned rules make Lamina passive
for ordinary feature, fix, refactor, and UI requests.

Before source edits, the agent must:

1. run `lamina work prepare` for the relevant workflows;
2. complete transactional graph design gaps until the slice is
   implementation-ready;
3. map every stable obligation to current evidence, code targets, and planned
   verification in `lamina.work-map/v1`;
4. pass `lamina work check`.

After implementation, the agent must reconcile observations and pass `lamina
work verify`. Surface obligations require independent functional, visual,
responsive, and accessibility evidence. Missing audit capability blocks
verification.

The ImplementationPacket includes the exact workflow closure and direct graph
provenance first. A derived repository-local lexical ranker supplies source
localization candidates. Dense vector retrieval is non-authoritative and is
not required for the initial contract: it remains unavailable until benchmark
evidence shows that it improves localization enough to justify a
checksum-managed local model. The CLI reports `lexical_degraded` rather than
silently making a network call or weakening the graph authority.

Provider setup uses marker-delimited, idempotent managed blocks in `AGENTS.md`,
`CLAUDE.md`, or an always-applied Cursor rule. Existing project instructions
outside the managed block are preserved.

`/lamina-design` and `/lamina-verify` remain advanced graph-only and
source-read-only overrides. Normal flow must not recommend them.

## Consequences

- Product knowledge is activated on every ordinary implementation request.
- Agents fail closed when the selected graph slice is stale, invalid, or
  incomplete.
- Requirement coverage becomes inspectable before edits and evidence-backed
  afterward.
- Source search helps find code but cannot redefine product truth.
- Vector search can be added later without changing packet identity or graph
  authority.
- Existing graph `approved` output remains compatible; `structural_valid`,
  `implementation_ready`, and `verified` make lifecycle state explicit.
