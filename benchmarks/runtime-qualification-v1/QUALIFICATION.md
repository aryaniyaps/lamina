# Runtime qualification v1 — final report (#58)

## Status

**Partial qualification — gates not met for epic close.**

Lamina commit `d94f8bdd` (PR stack through #77 / `perf/issue-77-linux-packaging`).
Recorded on Linux x64 qualification host (65 GiB RAM, kernel `7.0.0-28-generic`) on
2026-08-04.

| Gate family | Result | Evidence |
| --- | --- | --- |
| Quality (#51 semantic oracle contracts) | **Pass** | `npm run test:semantic-oracle` |
| Quality (#61 real-repository oracle contracts) | **Pass** | `npm run test:real-repository-oracle` |
| Harness (#60 baseline contracts) | **Pass** | `npm run test:runtime-baseline` |
| Linux packaging (#57, ≤750 MiB) | **Pass** | `linux_packaging_contract_test.mjs`; release workflow footprint gate |
| Product baseline matrix (small) | **Fail** | `initial-observation` refused after promotion success; see below |
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

| Scenario | Pre-#53 baseline (BASELINE.md) | Post-#53–#77 (this run) |
| --- | --- | --- |
| Footprint | Valid (~405 MiB peak) | **Valid** (~386 MiB cgroup peak) |
| Doctor/status/startup | Valid (median 459 ms cold) | **Valid** (cold samples complete) |
| Initial observation | Invalid (`pids` refusal) | **Refused** — promotion run **succeeded**; cold sample 2 `preflight_refused` (`existing Lamina processes must stop before launch`) |
| Retrieval readiness | Blocked | Blocked |
| Warm preparation (30 samples) | Blocked | Blocked |
| Remaining scenarios | Blocked | Blocked |

Root cause for current refusal: **graphd lifecycle leak between cold samples**
within `initial-observation`, not aggregate `pids.max` on the promotion path.
Owning area: #70 lifecycle / graphd shutdown between isolated baseline samples.

Attribution reference:
[`benchmarks/runtime-baseline-v1/attribution/small.json`](../runtime-baseline-v1/attribution/small.json).

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
- Product scenario gates: `initial-observation.complete` **fail** (refused)
- Blocking deferred: baseline promotion incomplete; runner exit 2
- `overall_pass`: **false**

Latency and RSS gates for warm preparation, no-op sync, incremental edits, and
idle RSS were **not measured** because the promotion fence stopped the matrix
after `initial-observation`.

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
node benchmarks/runtime-qualification-v1/run.mjs run \
  --profile 16gb --fixture small \
  --output /tmp/lamina-runtime-qualification-small \
  --model dist/runtime-baseline-inputs/model.onnx \
  --worker dist/runtime-baseline-inputs/cocoindex-worker
```

Use a **fresh** `LAMINA_SAFE_RUNNER_STATE_DIR` when the workload command identity
changes. See [`README.md`](README.md).

---

## Test commands (all pass on this commit)

```bash
npm run test:runtime-qualification
npm run test:runtime-baseline
npm run test:semantic-oracle
npm run test:real-repository-oracle
node tests/linux_packaging_contract_test.mjs
```

---

## Phase 4 readiness

**Not ready.** Executable #53–#57 leaves are merged, but #58 product measurement
gates fail on small-tier `initial-observation` cold-sample isolation. Close #58
only after a complete small run, then medium/large promotion, with updated
committed results and workflow artifacts.
