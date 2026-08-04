# Runtime qualification v1 — final report (#58)

## Status

**Small-tier product matrix complete under unchanged `pids.max=64`; gate
`overall_pass` remains false** (latency thresholds + semantic-oracle fixture
expects a live `graphd.lock` after CLI exit under bounded topology).

Lamina commit on branch `perf/issue-58-qualification` (PR #87). Recorded on Linux
x64 qualification host (65 GiB RAM, kernel `7.0.0-28-generic`) on 2026-08-04.

| Gate family | Result | Evidence |
| --- | --- | --- |
| Quality (#51 semantic oracle contracts) | **Fail (host)** | `npm run test:semantic-oracle` — `graphd.lock` missing after CLI finalize |
| Quality (#61 real-repository oracle contracts) | **Pass** | `npm run test:real-repository-oracle` |
| Harness (#60 baseline contracts) | **Pass** | `npm run test:runtime-baseline` |
| Linux packaging (#57, ≤750 MiB) | **Pass** | `linux_packaging_contract_test.mjs`; release workflow footprint gate |
| Product baseline matrix (small) | **Pass (12/12 valid)** | `/tmp/lamina-qual-clean-1785823165` — `complete: true` |
| Latency / cold gates (16 GB profile) | **Fail** | warm p95, noop p95, first-useful cold over thresholds |
| Medium / large tiers | **Deferred** | Not yet promoted |
| macOS / Windows | **Deferred** | #78 process-control adapters |
| Linux arm64 full matrix | **Deferred** | Packaging release-qualified; runtime matrix workflow_dispatch on arm64 runners |

Machine-readable result:
[`results/linux-x64-small-partial.json`](results/linux-x64-small-partial.json)
(also mirrored as [`results/linux-x64-small.json`](results/linux-x64-small.json)).

**#58 and #49 must remain open** until `overall_pass` is true with committed
evidence (latency gates and semantic-oracle lock lifecycle still block epic
close). Do **not** raise `pids.max`.

---

## Architecture summary (ADR-015 / ADR-016)

Selected path: **bounded topology + tuned concurrency** retaining **ADR-012 hybrid
retrieval** (exact id/alias, Ladybug FTS/BM25, INT8 ONNX dense leg, RRF fusion,
exact graph closure). Dense semantic retention confirmed in ADR-016; lexical-only
rejected on held-out gates.

Removed or deferred:

- Lexical-only product mode (Spike 2 fail)
- macOS/Windows native qualification (#78)
- Unbounded CocoIndex/graphd thread pools (replaced by `runtime-budget.mjs`)

---

## Baseline vs final (small tier, Linux x64)

| Scenario | Pre-#53 baseline (BASELINE.md) | This run (`/tmp/lamina-qual-clean-1785823165`) |
| --- | --- | --- |
| Footprint | Valid (~405 MiB peak) | **Valid** (`peak_pids: 16`) |
| Doctor/status/startup | Valid | **Valid** (3/3; peaks 25–31) |
| Initial observation | Invalid (`pids` refusal) | **Valid** (3/3; peaks 33–34) |
| Retrieval readiness | Invalid (`pids` / events) | **Valid** (3/3; peaks **33–34**, `pids.events.max: 0`) |
| First useful preparation | Blocked | **Valid** (3/3; peaks 33–34) |
| Warm preparation | Blocked | **Valid** (peak 33) |
| No-op synchronization | Blocked | **Valid** (peak 34) |
| One-file / multi-file change | Blocked | **Valid** (peaks 33) |
| Full derived-state rebuild | Blocked | **Valid** (3/3; peaks 33–34) |
| Post-command idle RSS | Blocked | **Valid** (peak 24) |
| Cancellation shutdown | Blocked | **Valid** (peak 34) |

Attribution reference:
[`benchmarks/runtime-baseline-v1/attribution/small.json`](../runtime-baseline-v1/attribution/small.json).

### Retrieval-readiness / prepare fixes landed

- Skip packaged-worker `index-embed -h` probe (ONNX ~40 TIDs racing graphd)
- `nproc-cap.so` + thread env on graphd and retrieval worker
- Drain / stop graphd before embed; checkpoint before hard stop
- Bounded `complete:true` defers native index create; **lazy `rebuildNativeIndexes({ force: true })` on first hybrid query**
- Derive source chunk `file`/`path` from text/`logical_key` when Ladybug returns empty `path`
- Mutable baseline inventory metadata; pass observation freshness into inventory status

---

## Platform matrix

| Platform | Packaging | Runtime matrix | Notes |
| --- | --- | --- | --- |
| Linux x64 | Qualified | **Small complete; overall_pass false** | This report |
| Linux arm64 | Qualified (~418 MiB install) | Deferred | `publish-cli.yml` checksum + footprint gate |
| macOS | Deferred (#78) | Deferred | Adapter refusal in release workflow |
| Windows | Deferred (#78) | Deferred | Adapter refusal in release workflow |

---

## Gate evaluation (small / 16 GB profile)

Committed evaluation summary from `linux-x64-small-partial.json`:

- Product scenario gates: **12/12 scenario completeness pass** under `pids.max=64`
- Latency gates still fail: warm p95, noop p95, first-useful cold
- Semantic-oracle suite exit non-zero on this host (missing `graphd.lock` after bounded finalize)
- `overall_pass`: **false**

---

## CI enforcement added

| Workflow | Purpose |
| --- | --- |
| `.github/workflows/runtime-qualification-presubmit.yml` | PR/push: contract tests + presubmit oracle suites + committed result schema validation |
| `.github/workflows/runtime-qualification.yml` | `workflow_dispatch` + weekly: full profile/fixture cell + artifact upload |

Presubmit does **not** run the 30-sample warm matrix or medium/large tiers.

---

## Reproduction

```bash
# Fast presubmit (no baseline measurement)
npm run test:runtime-qualification:presubmit

# Full small cell (requires production safe-runner + pinned cli-v0.3.5 assets)
export LAMINA_SAFE_RUNNER_STATE_DIR=/tmp/lamina-runtime-qualification-safe-state
npm run safe:self-test -- --require-production
node benchmarks/runtime-baseline-v1/run.mjs run \
  --fixture small \
  --output /tmp/lamina-runtime-qualification-small \
  --model dist/runtime-baseline-inputs/model.onnx \
  --worker dist/runtime-baseline-inputs/cocoindex-worker
```

Use a **fresh** `LAMINA_SAFE_RUNNER_STATE_DIR` when the workload command identity
changes. Ensure no concurrent baseline runs — orphaned Lamina descendants cause
`preflight_refused` on subsequent scenarios. See [`README.md`](README.md).

---

## Test commands

```bash
node tests/runtime_budget_test.mjs
node tests/retrieval_runtime_test.mjs
npm run test:runtime-qualification
npm run test:runtime-baseline
npm run test:real-repository-oracle
node tests/linux_packaging_contract_test.mjs
```

`npm run test:semantic-oracle` currently fails on this branch when bounded
topology finalizes graphd before the fixture reads `graphd.lock` — track
separately from the pids matrix.

---

## Phase 4 readiness

**Not ready for epic close.** Small-tier **safety** qualification under
`pids.max=64` is green (12/12 valid, readiness peaks 33–34, `events.max: 0`).
`overall_pass` remains false until latency gates and semantic-oracle lock
lifecycle are resolved, then medium/large promotion with committed artifacts.

**Do not close #49 / #58** on this evidence alone.
