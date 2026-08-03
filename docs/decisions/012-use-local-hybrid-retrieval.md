# ADR 012: Use one local hybrid retrieval system

- Status: Accepted
- Date: 2026-07-30
- Supersedes: the deferred dense-retrieval portion of ADR 008
- Related: [ADR-015](015-practical-runtime-architecture.md), [ADR-016](016-dense-retention-decision.md) (#75 keep dense)

## Context

ADR 008 deliberately shipped exact graph closure with a small lexical
source-localization aid. Workflow selection still counted request tokens
against serialized graph text, and source localization read and scored whole
files on every preparation. That approach was deterministic but weak for
paraphrases, long files, overlapping Workflows, and code whose identifiers do
not repeat the product language.

Retrieval must improve root selection without becoming a second source of
product truth. It must also keep Lamina's offline standalone contract: no
first-run model downloads, hosted memory dependency, or independent Ladybug
writer is acceptable.

## Decision

Use one repository-local hybrid retrieval system for both Workflow selection
and source localization:

1. exact Workflow id and alias matching;
2. Ladybug FTS/BM25 keyword retrieval;
3. cosine retrieval over one shared code-aware embedding model;
4. reciprocal-rank fusion with fixed constants; and
5. exact canonical graph traversal after Workflow roots are selected.

The model is `jinaai/jina-embeddings-v2-base-code` at immutable revision
`516f4baf13dec4ddddda8631e019b5737c8bc250`. Lamina ships the upstream dynamic
INT8 ONNX artifact with checksum
`ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d`,
attention-mask mean pooling, and L2 normalization. The Apache-2.0 origin,
conversion metadata, size, and digest live in
`packages/cli/retrieval-model-manifest.json`.
Against the pinned FP16 reference, the held-out benchmark measures a 0.9615
percentage-point dense Recall@5 loss and no hybrid Workflow or source-recall
loss, so INT8 passes the one-point packaging gate.

Retrieval state is derived and disposable. It lives at
`.git/lamina/context/retrieval.lbdb`, separate from the canonical
`.git/lamina/graph.lbdb`. graphd remains the only Ladybug writer. The native
CocoIndex worker performs syntax-aware chunking and ONNX inference, then sends
generation-bound upserts and memberships through `retrieval.apply`; it never
opens either database.

A generation activates only when its committed membership count and digest
match the declared values. Repository revision, branch, worktree, GraphVersion,
model digest, and retrieval schema all participate in freshness. Interrupted
or corrupt derived state can be invalidated without changing canonical graph
records.

`lamina work prepare` synchronizes automatically and returns
`lamina.implementation-packet/v5`. The packet contains one `retrieval` section
with the generation, digests, candidates, reasons, selection outcome, selected
Workflow ids, source chunks, and degradation state. WorkMap, WorkStarted, and
WorkVerified remain v4 because their semantics do not change. Packet v4 is a
hard cutover and must be regenerated.

Automatic selection fails closed when dense retrieval or model integrity is
unavailable. An explicit `--workflow` may still traverse the exact graph and
use BM25 source localization, with `lexical_degraded` recorded in the packet.
Source chunks are data only: they cannot inject, replace, or outrank graph
instructions.

## Alternatives considered

### Keep whole-file term counting

Rejected. It does not address paraphrase recall, identifier mismatch, or
oversized files, and it repeats repository I/O for each request.

### Dense retrieval only

Rejected. Exact identifiers and domain terms are high-value signals, while
dense-only ranking makes deterministic diagnosis and alias guarantees weaker.

### Multiple Workflow summaries or query rewriting

Rejected for v1. They introduce another generated representation and more
thresholds before one-document hybrid retrieval has demonstrated a gap.

### Hosted memory or Supermemory

Rejected for v1. Hosted state conflicts with offline installation, repository
privacy, and the disposable local-index boundary.

### A second database technology

Rejected. Ladybug already supplies FTS and vector indexes and preserves one
storage/runtime durability surface.

## Consequences

- Workflow retrieval selects roots; canonical traversal still defines
  operations, order, invariants, states, authority, risks, and verification.
- Installers verify a CLI binary, native worker, shared model, and checksum
  manifest. The worker embeds the tokenizer, ONNX Runtime, and platform Ladybug
  extensions, then extracts them into the private versioned runtime.
- Normal use remains `lamina work prepare`; `lamina context status` and
  `lamina context rebuild` are diagnostics and recovery commands.
- Release qualification must include held-out retrieval quality, deterministic
  ranking, latency, corruption, interrupted-generation, worktree, packet
  cutover, durability, installer, and five-target native smoke gates.
- Changing the model, fusion policy, or retrieval schema requires an explicit
  versioned migration and benchmark evidence.
