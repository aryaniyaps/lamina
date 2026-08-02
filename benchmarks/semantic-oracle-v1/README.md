# Normalized semantic behavior oracle v1

This compact deterministic oracle freezes Lamina's product-behavior meaning,
not Ladybug bytes, graph backup layout, packet JSON, or retrieval ranking. A
candidate implementation passes by adapting one immutable native observation
to `lamina.semantic-result/v1` and matching the reviewed fixture.

## Reviewed fixture

`fixtures/compact-product-lifecycle.json` contains the expected semantic
result, two explicit forbidden partial-publication Resources, 56 executable
positive/negative cases, and 28 seeded mutations. The fixture is committed
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
  their unresolved completeness state; and
- a compact derived projection materialized, hashed, corrupted/deleted, and
  rebuilt from the same GraphVersion while the canonical head remains fixed.

`generated_by_ids` is normalized and preserved by the adapter, but this v1
fixture has no generator-producing runtime case. Its positive provenance gate
is the complete engine-owned epistemic-class set plus direct Evidence edges;
it does not claim generator-edge coverage.

## Validation and grading

The JSON Schemas are:

- `schema/result.schema.json` — `lamina.semantic-result/v1`;
- `schema/fixture.schema.json` — `lamina.semantic-fixture/v1`.

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

The current adapter consumes `lamina-graph-backup-v1` plus observed current
publication receipts, implementation-context obligations, WorkMap statuses,
and context-catalog authority. `alternate-records-v1.mjs` proves a differently
keyed raw format can normalize to the identical semantic result. Adapters may
rearrange native data; they may not read the expected fixture, synthesize
missing obligations, or repair behavior.

## Run

```bash
npm run test:semantic-oracle
```

The suite runs only compact temporary Git fixtures. It does not execute the
real-repository observation/retrieval matrix reserved for issue #61 and does
not alter production retrieval, scoring, storage, or runtime architecture.
