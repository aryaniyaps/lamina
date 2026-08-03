# Runtime qualification v1

Final release gate for epic [#49](https://github.com/aryaniyaps/lamina/issues/49)
and issue [#58](https://github.com/aryaniyaps/lamina/issues/58). This harness
extends the [#60](https://github.com/aryaniyaps/lamina/issues/60) real-repository
baseline with gate evaluation, oracle-suite enforcement, and committed evidence.

Human-readable status: [`QUALIFICATION.md`](QUALIFICATION.md).
Machine-readable results: [`results/`](results/).

## What runs where

| Mode | Host | Scope | Trigger |
| --- | --- | --- | --- |
| Presubmit | Linux CI + dev | Oracle contract suites (`#51`, `#61`, `#60`, `#57` packaging contract), gate logic tests, committed partial result validation | PR / push via `runtime-qualification-presubmit.yml` |
| Presubmit CLI | Linux with production safe-runner | `node benchmarks/runtime-qualification-v1/presubmit.mjs` | Local fast check |
| Full matrix | Qualified Linux x64 (workflow_dispatch) | Baseline product scenarios per profile/fixture + oracle suites + artifact upload | `.github/workflows/runtime-qualification.yml` |
| Full matrix (scheduled) | Same | Weekly/manual complete re-qualification | `runtime-qualification.yml` cron |
| Local partial | Developer workstation | Small fixture minimum when assets and safe-runner production attestation are available | Documented below |

macOS and Windows remain deferred ([#78](https://github.com/aryaniyaps/lamina/issues/78)).
Linux arm64 packaging is release-qualified; full runtime matrix on arm64 runners
is workflow_dispatch-only when hardware is available.

## Profiles

| Profile | Fixtures | Peak RSS gate | Notes |
| --- | --- | ---: | --- |
| `16gb` | small, medium, large | ≤ 1.5 GiB | Full qualification matrix |
| `8gb` | small, medium | ≤ 2.0 GiB | Large refused by policy |

Warm p95 latencies use 30 measured samples (1 warm-up excluded) per
`runtime-baseline-v1`. Cold scenarios use 3–5 isolated runs.

## Local reproduction (small tier minimum)

Requirements match [runtime baseline v1](../runtime-baseline-v1/BASELINE.md):
production safe-runner attestation, cgroup-v2 enforcement, checksum-pinned
`cli-v0.3.5` worker and model assets.

```bash
LAMINA_SAFE_RUNNER_STATE_DIR=/tmp/lamina-runtime-qualification-safe-state \
  npm run safe:self-test -- --require-production

# Download pinned assets once (paths may vary):
mkdir -p dist/runtime-baseline-inputs
# ... same URLs and digests as runtime-baseline-v1/manifest.json

node benchmarks/runtime-qualification-v1/run.mjs run \
  --profile 16gb \
  --fixture small \
  --output /tmp/lamina-runtime-qualification-small \
  --model dist/runtime-baseline-inputs/model.onnx \
  --worker dist/runtime-baseline-inputs/cocoindex-worker
```

Presubmit-only (no baseline measurement, oracle contracts only):

```bash
npm run test:runtime-qualification:presubmit
```

Validate a committed or CI-produced result:

```bash
node benchmarks/runtime-qualification-v1/run.mjs validate \
  --file benchmarks/runtime-qualification-v1/results/linux-x64-small-partial.json
```

## Scenario coverage map

Product measurement scenarios come from `runtime-baseline-v1`. Rename/delete,
branch/worktree, and interrupted-recovery behavioral gates are enforced by the
[#61](../real-repository-oracle-v1/README.md) oracle contract and scenario
verification without duplicating them in the baseline workload. Network-disabled
operation is proven by the Linux packaging offline smoke when
`LAMINA_OFFLINE_SMOKE=1` and staged release assets are present.

See [`manifest.json`](manifest.json) `scenario_coverage` for the authoritative map.

## Related decisions

- [ADR-015](../../docs/decisions/015-practical-runtime-architecture.md) — selected architecture
- [ADR-016](../../docs/decisions/016-dense-retention-decision.md) — dense retention
- [ADR-014](../../docs/decisions/014-crash-safe-resource-supervision.md) — safe-runner limits (not raised)
