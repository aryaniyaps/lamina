# ADR 016: Retain mandatory dense retrieval (#75)

- Status: Accepted
- Date: 2026-08-04
- Parent: [#56](https://github.com/aryaniyaps/lamina/issues/56) (Phase 2 semantic leaves)
- Tracks: [#75](https://github.com/aryaniyaps/lamina/issues/75) decision leaf, [#76](https://github.com/aryaniyaps/lamina/issues/76) implementation leaf
- Related: [ADR-012](012-use-local-hybrid-retrieval.md), [ADR-015](015-practical-runtime-architecture.md), [Spike 2 evidence](../../benchmarks/runtime-baseline-v1/spikes/b-lexical-first.json), [comparison matrix](../../benchmarks/runtime-baseline-v1/spikes/c56-dense-comparison-matrix.json)

## Context

ADR-015 Slice 3 Spike 2 (Family B — structural / lexical-first) measured whether
BM25-only retrieval could meet the #51 held-out gates without the 161.9 MiB INT8
ONNX model. Issue #75 requires a formal, evidence-backed keep/remove decision
before Phase 2 implements bounded dense optimizations (#76).

## Decision

**KEEP** mandatory dense semantic retrieval inside the ADR-012 hybrid system.

Do **not** remove `jinaai/jina-embeddings-v2-base-code` INT8 assets, the
tokenizer, or the dense leg of reciprocal-rank fusion. Optimize cost and latency
inside hybrid (#76) rather than removing dense.

## Evidence (Spike 2 / identical fixture pins)

Held-out evaluation on `benchmarks/retrieval-v1/` (`b-lexical-first-eval.mjs`):

| Gate | BM25-only | ADR-012 threshold | Pass |
| --- | ---: | ---: | --- |
| exact id/alias | 1.00 | 1.00 | yes |
| multi-Workflow selection | 0.00 | ≥ 0.95 | **no** |
| incorrect new-Workflow attachment | 0.00 | ≤ 0.02 | yes |
| Workflow Recall@5 | 0.94 | ≥ 0.98 (hybrid bar) | **no** |
| source Recall@10 | 0.80 | ≥ 0.90 (hybrid bar) | **no** |

Spike verdict:
`lexical_only_fails_held_out_gates_keep_hybrid_dense`
([`b-lexical-first.json`](../../benchmarks/runtime-baseline-v1/spikes/b-lexical-first.json)).

## Alternative matrix (#75 acceptance)

Committed comparison on identical pins
([`c56-dense-comparison-matrix.json`](../../benchmarks/runtime-baseline-v1/spikes/c56-dense-comparison-matrix.json)):

| Mode | Workflow R@5 | multi-Workflow | source R@10 | Dense leg |
| --- | ---: | ---: | ---: | --- |
| BM25-only (no dense) | 0.94 | 0.00 | 0.80 | removed |
| Bounded hybrid (#76) | meets gates | meets gates | meets gates | retained, capped pool |
| Full hybrid (pre-#76) | meets gates | meets gates | meets gates | retained, full pool |

Bounded hybrid matches full hybrid on held-out rows because fixture corpora per
graph are below the 64-candidate dense cap; production corpora use the same
union policy documented in `packages/cli/lib/retrieval-runtime/scoring.mjs`.

## Consequences

- #76 implements bounded dense batching, ONNX thread caps, and lazy dense on
  the lexical∪dense candidate pool — not removal.
- #57 packaging continues to ship the sealed INT8 model and worker.
- `lexical_degraded` remains an explicit bypass for `--workflow`, not a product
  default (#76 does not generalize Spike 2 failure mode).

## Alternatives rejected

| Alternative | Verdict | Evidence |
| --- | --- | --- |
| Remove dense / BM25-only product | **Rejected** | Spike 2 held-out failures above |
| Weaken #51 gates for footprint | **Rejected** | ADR-015 non-elimination policy |
| Replace model without benchmark | **Deferred** | Requires new ADR + held-out evidence |
