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
node benchmarks/retrieval-v1/benchmark.mjs --calibrate \
  --model /path/to/lamina-retrieval-model-int8-v1.onnx \
  --tokenizer /path/to/tokenizer.json \
  --model-digest ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d
```

After committing the frozen constants, run the held-out release gate:

```bash
node benchmarks/retrieval-v1/benchmark.mjs --evaluate \
  --model /path/to/lamina-retrieval-model-int8-v1.onnx \
  --tokenizer /path/to/tokenizer.json \
  --model-digest ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d
```

The evaluator reports the former term-count baseline, BM25, dense, and hybrid
results, then enforces the held-out quality, determinism, and latency gates
recorded in ADR 012. Calibration output never includes held-out metrics. The
model manifest records the pinned FP16 reference digest and the frozen
INT8-versus-FP16 result: dense Recall@5 loses 0.9615 percentage points while
hybrid Workflow and source recall are identical, so v1 ships INT8.
