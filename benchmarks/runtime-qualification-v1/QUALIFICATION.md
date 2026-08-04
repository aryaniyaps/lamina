# Runtime qualification v1 — final report (#58)

## Status

**Partial qualification — gates not met for epic close.**

Lamina commit on branch `perf/issue-58-qualification` (PR #87). Recorded on Linux x64
qualification host (65 GiB RAM, kernel `7.0.0-28-generic`) on 2026-08-04.

| Gate family | Result | Evidence |
| --- | --- | --- |
| Quality (#51 semantic oracle contracts) | **Pass** | `npm run test:semantic-oracle` |
| Quality (#61 real-repository oracle contracts) | **Pass** | `npm run test:real-repository-oracle` |
| Harness (#60 baseline contracts) | **Pass** | `npm run test:runtime-baseline` |
| Linux packaging (#57, ≤750 MiB) | **Pass** | `linux_packaging_contract_test.mjs`; release workflow footprint gate |
| Product baseline matrix (small) | **Fail** | `first-useful-preparation` invalid (`retrieval_fts` missing under deferred native index) |
| Medium / large tiers | **Deferred** | Promotion fence after small incomplete |
| macOS / Windows | **Deferred** | #78 process-control adapters |
| Linux arm64 full matrix | **Deferred** | Packaging release-qualified; runtime matrix workflow_dispatch on arm64 runners |

Machine-readable partial result:
[`results/linux-x64-small-partial.json`](results/linux-x64-small-partial.json).

**#58 and #49 must remain open** until the full small/medium/large matrix passes
under unchanged safe-runner limits with committed evidence.

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

| Scenario | Pre-#53 baseline (BASELINE.md) | Post-#53–#77 + lifecycle fix (this run) |
| --- | --- | --- |
| Footprint | Valid (~405 MiB peak) | **Valid** (~386 MiB cgroup peak) |
| Doctor/status/startup | Valid (median 459 ms cold) | **Valid** (3/3 cold samples; no preflight refusal) |
| Initial observation | Invalid (`pids` refusal) | **Valid** (3/3 cold samples; graphd released between samples) |
| Retrieval readiness | Blocked | **Valid** — promotion success at `peak_pids: 33–34`, `pids.events.max: 0` |
| First useful preparation | Blocked | **Invalid** — `LAMINA_RETRIEVAL_CORRUPT` (`retrieval_fts` index absent under deferred native index) |
| Warm preparation (30 samples) | Blocked | Blocked after first-useful-preparation |
| Remaining scenarios | Blocked | Blocked |

**#70 graphd lifecycle gap (closed for observation path):** CLI commands now call
`finalizeRuntimeCommand` on exit under bounded topology; baseline workload
`disposeRepository` uses the same teardown. Cold-sample preflight refusal on
`initial-observation` is resolved.

**Retrieval-readiness pids blocker (closed):** `initial-retrieval-readiness` now
passes promotion with peak tasks **33–34** (ADR headroom target) and
`pids.events.max: 0`. Fork bursts during split observe → `context rebuild` were
reduced by skipping the post-snapshot `replaceGraphdFresh` on the `index-embed`
path, using a single `ensureGraphd` for batched apply after embed-only worker
exit, and avoiding a second `ensureRetrieval` cycle for inventory validation.

Attribution reference:
[`benchmarks/runtime-baseline-v1/attribution/small.json`](../runtime-baseline-v1/attribution/small.json).

Latest rerun (2026-08-04, fresh safe-runner state, `/tmp/lamina-qual-pids-events`):
footprint + doctor + initial-observation + initial-retrieval-readiness **valid**
(4/12 small scenarios); `initial-retrieval-readiness` promotion **valid** at
`peak_pids: 33`, `pids.events.max: 0`.

Fixes landed on this branch for retrieval-readiness:

- Split `initial-retrieval-readiness` into separate `graph observe` and
  `context rebuild` CLI subprocesses under bounded topology (workload.mjs)
- Skip `replaceGraphdFresh` when `index-embed` path will stop graphd anyway;
  `applyRetrievalIndexPlan` uses `ensureGraphd` once after embed-only worker
  (process.mjs)
- Inventory validation without document bodies or second `ensureRetrieval` cycle
  (workload.mjs `inventoryFromRetrievalStatus` fallback)
- `drainRuntimeDescendants` + `forceStopManagedGraphd` before `index-embed`;
  bounded fast `complete:true` activation path (`defer_retrieval_native_index`)
- `applyLadybugThreadCap` + `nproc-cap.so` preload for graphd Ladybug pools
- Prior branch fixes: graphd thread caps, embedded lifecycle, sealed runtime,
  split `index-embed` + CLI-side batched apply, lazy GraphEngine init

---

## Platform matrix

| Platform | Packaging | Runtime matrix | Notes |
| --- | --- | --- | --- |
| Linux x64 | Qualified | **Partial** (small incomplete) | This report |
| Linux arm64 | Qualified (~418 MiB install) | Deferred | `publish-cli.yml` checksum + footprint gate |
| macOS | Deferred (#78) | Deferred | Adapter refusal in release workflow |
| Windows | Deferred (#78) | Deferred | Adapter refusal in release workflow |

---

## Gate evaluation (small / 16 GB profile)

Committed evaluation summary from `linux-x64-small-partial.json`:

- Oracle suites: 4/4 pass
- Product scenario gates: 18/22 pass (`initial-retrieval-readiness` **pass**; `first-useful-preparation` **fail**)
- Small scenarios valid: **4/12** (footprint, doctor-status-startup, initial-observation, initial-retrieval-readiness)
- Blocking deferred: baseline promotion incomplete; runner exit 2
- `overall_pass`: **false**

Warm preparation, no-op sync, incremental edits, and idle RSS were **not measured**
because the promotion fence stopped the matrix after `first-useful-preparation`.

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

## Test commands (pass on this commit)

```bash
node tests/runtime_budget_test.mjs
node tests/retrieval_runtime_test.mjs
npm run test:runtime-qualification
npm run test:runtime-baseline
npm run test:semantic-oracle
npm run test:real-repository-oracle
node tests/linux_packaging_contract_test.mjs
```

`retrieval_native_index_test.mjs` requires `npm run safe:run -- --tier small --workload retrieval-v1 --report .lamina-safe-runner/retrieval-native-index.json -- node tests/retrieval_native_index_test.mjs`.

---

## Phase 4 readiness

**Not ready.** Small-tier measurement now clears `initial-retrieval-readiness`
(`pids.events.max: 0`, `peak_pids: 33–34`) but stops at `first-useful-preparation`
(`retrieval_fts` missing when native index build is deferred). Close #58 only
after a complete small run, then medium/large promotion, with updated committed
results and workflow artifacts.

**Remaining blocker:** deferred native retrieval index prevents hybrid query at
`work prepare` time. Next work should build or lazily recover `retrieval_fts`
without tripping cgroup `pids` limits.
