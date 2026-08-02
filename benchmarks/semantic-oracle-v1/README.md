# Normalized semantic behavior oracle v1

This compact deterministic oracle freezes Lamina's product-behavior meaning,
not Ladybug bytes, graph backup layout, packet JSON, or retrieval ranking. A
candidate implementation passes by adapting one immutable native observation
to `lamina.semantic-result/v1` and matching the reviewed fixture.

## Reviewed fixture

`fixtures/compact-product-lifecycle.json` contains the expected semantic
result, two explicit forbidden partial-publication Resources, 61 executable
positive/negative cases, and 31 seeded mutations. The fixture is committed
review data. Tests never regenerate or update it from the implementation under
test.

The compact lifecycle covers:

- Resources, relations, six epistemic classes, evidence, Contradictions,
  GraphVersions, parent lineage, branch heads, and active closure;
- Actor and Persona identity, two ordered Workflow operations, State and
  transition, permission, invariant, failure Scenario, Decision, proof, and
  runtime/human verification evidence;
- successful publication, mechanical validation failure, an injected
  interruption after the transactional branch-head write, CAS rejection,
  rebase without a lost update, and linked-worktree branch isolation;
- real implementation obligations compiled by the current WorkMap path,
  including Workflow scope, contract details, source Statement identity, and
  a reviewed mix of `already_satisfied` and `change_required` completeness
  states; and
- a compact derived projection materialized, hashed, corrupted/deleted, and
  rebuilt from the same GraphVersion while the canonical head remains fixed.

`generated_by_ids` is normalized and preserved by the adapter. The v1 fixture
directly seeds one canonical `GENERATED_BY` edge through the graph engine, then
proves preservation and detects its loss. This is deliberately fixture-only:
the current public CLI has no supported producer for generator edges, and this
oracle does not claim that one exists.

## Validation and grading

The JSON Schemas are:

- `schema/result.schema.json` — `lamina.semantic-result/v1`;
- `schema/fixture.schema.json` — `lamina.semantic-fixture/v1`; and
- `schema/current-observation.schema.json` — the exact
  `lamina.current-semantic-observation/v1` boundary consumed by the native
  adapter, including graph-backup records, WorkMap arrays, and
  operation-discriminated CLI success/failure payloads.

The deterministic validator additionally enforces identity uniqueness,
locale-independent ordering, reference integrity, acyclic/reachable lineage,
delta-to-active consistency, branch/head closure equality, publication outcome
invariants, atomic failed/interrupted visibility, derived-state authority, and
the executable fixture case matrix.

Failures are classified separately:

- `LAMINA_SEMANTIC_FIXTURE_INVALID`: reviewed fixture or case-matrix defect;
- `candidate_invalid`: malformed or internally contradictory candidate result;
- `product_regression`: schema-valid semantic mismatch with a focused
  collection/id/field diff.

The current adapter consumes `lamina.current-semantic-observation/v1`: a
`lamina-graph-backup-v1` plus observed publication receipts,
implementation-context obligations, the accepted WorkStarted/WorkMap receipt,
CLI outcomes, and context-catalog authority. Its CLI evidence includes graph
restore, status, query, and backup successes; WorkMap derivation and accepted
check; and structured invalid-publication, unresolved-WorkMap, and tampered-
restore failures. `alternate-records-v1.mjs` proves a differently keyed raw
format can normalize to the identical semantic result. Adapters may rearrange
native data; they may not read the expected fixture, synthesize missing
obligations, or repair behavior.

## Run

```bash
npm run test:semantic-oracle
```

The suite runs only compact temporary Git fixtures. It does not execute the
separate real-repository observation/retrieval matrix and does not alter
production retrieval, scoring, storage, or runtime architecture.
