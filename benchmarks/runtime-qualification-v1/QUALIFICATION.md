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
| Product baseline matrix (small) | **Fail** | `initial-retrieval-readiness` promotion `safety_limit_exceeded` at `pids` |
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
| Retrieval readiness | Blocked | **Invalid** — promotion `safety_limit_exceeded` at `pids` (`peak_pids: 54`, `pids.events.max: 5`) |
| Warm preparation (30 samples) | Blocked | Blocked after retrieval-readiness |
| Remaining scenarios | Blocked | Blocked |

**#70 graphd lifecycle gap (closed for observation path):** CLI commands now call
`finalizeRuntimeCommand` on exit under bounded topology; baseline workload
`disposeRepository` uses the same teardown. Cold-sample preflight refusal on
`initial-observation` is resolved.

**Current small-tier blocker:** `initial-retrieval-readiness` still trips cgroup
`pids` enforcement during the split observe → `context rebuild` promotion path.
Peak sampled tasks dropped from 64 to **54** (ADR headroom target), but
`pids.events.max` reached **5** — fork attempts were refused before the peak
counter saturated. Attribution shows four graphd sessions (peak 29 threads each),
three retrieval-worker descendants, and fifteen `other` processes during the
apply burst; no `detached_descendant` or dual-graphd overlap.

Attribution reference:
[`benchmarks/runtime-baseline-v1/attribution/small.json`](../runtime-baseline-v1/attribution/small.json).

Latest rerun (2026-08-04, fresh safe-runner state, `/home/aryan/lamina-qual-out7-1785815404`):
footprint + doctor + initial-observation **valid** (3/12 small scenarios);
`initial-retrieval-readiness` promotion **invalid** at `peak_pids: 54`,
`pids.events.max: 5` (`limit: pids`, not `detached_descendant`).

Fixes landed on this branch (not yet sufficient for promotion pass):

- Split `initial-retrieval-readiness` into separate `graph observe` and
  `context rebuild` CLI subprocesses under bounded topology (workload.mjs)
- `drainRuntimeDescendants` + `forceStopManagedGraphd` before `index-embed`;
  `restartGraphd` before batched `retrieval.apply` (process.mjs)
- Bounded fast `complete:true` activation path skipping heavy native-index scans
  (`defer_retrieval_native_index`, store.mjs)
- `applyLadybugThreadCap` on wrapped Ladybug connections (runtime-budget.mjs)
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
- Product scenario gates: 17/19 pass (`initial-observation` **pass**; `initial-retrieval-readiness` **fail**)
- Small scenarios valid: **3/12** (footprint, doctor-status-startup, initial-observation)
- Blocking deferred: baseline promotion incomplete; runner exit 2
- `overall_pass`: **false**

Warm preparation, no-op sync, incremental edits, and idle RSS were **not measured**
because the promotion fence stopped the matrix after `initial-retrieval-readiness`.

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

**Not ready.** The #70 graphd cold-sample isolation blocker is fixed; small-tier
measurement now stops at `initial-retrieval-readiness` (`pids.events.max` > 0 at
`peak_pids: 54`). Close #58 only after a complete small run, then medium/large
promotion, with updated committed results and workflow artifacts.

**Remaining blocker:** transient fork bursts during `context rebuild` (observe +
index-embed + graphd restart + batched apply) still produce `pids.events.max` > 0
under the 64-task ceiling without raising `pids.max`. Next work should target
serializing graphd/index-embed overlap and reducing short-lived descendant churn.
