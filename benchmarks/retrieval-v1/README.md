# Lamina retrieval v1 benchmark

This committed benchmark generates four overlapping product graphs, 240
Workflow-selection queries, and 120 source-localization queries. Query
categories cover exact ids and aliases, low-overlap paraphrases, Personas,
Invariants, failure states, Surfaces, Operations, multi-Workflow work,
genuinely new Workflows, and adversarial domain-irrelevant requests.

The split is deterministic. Threshold constants are changed only against the
development rows; release qualification reports the frozen held-out rows.

Validate fixture cardinality without a model:

```bash
node benchmarks/retrieval-v1/benchmark.mjs
```

Calibrate and freeze thresholds using only development rows:

```bash
npm run safe:self-test -- --require-production
npm run safe:run -- --tier small --workload retrieval-calibration-v1 \
  --report .lamina-safe-runner/retrieval-calibrate.json -- \
  node benchmarks/retrieval-v1/benchmark.mjs --calibrate \
  --worker dist/lamina-cocoindex-worker-linux-x64 \
  --model dist/lamina-retrieval-model-int8-v1.onnx \
  --tokenizer dist/retrieval-benchmark-runtime/tokenizer.json \
  --model-digest ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d
```

After committing the frozen constants, run the exact held-out command at small
to create promotion evidence. `bench:retrieval` is intentionally incomplete
without caller-supplied repository asset arguments and returns an actionable
preflight refusal when they are absent:

```bash
npm run bench:retrieval -- \
  --worker dist/lamina-cocoindex-worker-linux-x64 \
  --model dist/lamina-retrieval-model-int8-v1.onnx \
  --tokenizer dist/retrieval-benchmark-runtime/tokenizer.json \
  --model-digest ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d
```

Then run the byte-for-byte same benchmark payload at medium:

```bash
npm run safe:run -- --tier medium --workload retrieval-v1 \
  --promote --report .lamina-safe-runner/retrieval-evaluate.json -- \
  node benchmarks/retrieval-v1/benchmark.mjs --evaluate \
  --worker dist/lamina-cocoindex-worker-linux-x64 \
  --model dist/lamina-retrieval-model-int8-v1.onnx \
  --tokenizer dist/retrieval-benchmark-runtime/tokenizer.json \
  --model-digest ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d
```

All three asset paths must be canonical physical files inside this repository;
the worker must be executable. The supplied digest must match both the model
bytes and `packages/cli/retrieval-model-manifest.json`, including its declared
byte size. The tokenizer is not independently pinned in that manifest; its
descriptor-copied bytes are instead bound into the frozen and snapshot
identities. Environment variables and uv fallback cannot supply or replace
these four explicit arguments, and no additional flags or positional tokens
are accepted. Before hashing, the manifest is limited to 1 MiB, the model and
worker to 256 MiB, and the tokenizer to 64 MiB.

The evaluator reports the former term-count baseline, BM25, dense, and hybrid
results, then enforces the held-out quality, determinism, and latency gates
recorded in ADR 012. Calibration output never includes held-out metrics. The
model manifest records the pinned FP16 reference digest and the frozen
INT8-versus-FP16 result: dense Recall@5 loses 0.9615 percentage points while
hybrid Workflow and source recall are identical, so v1 ships INT8.
