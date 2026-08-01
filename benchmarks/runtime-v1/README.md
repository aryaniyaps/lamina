# Practical-runtime benchmark harness v1

This harness proves Lamina's measurement contract on a deliberately tiny,
deterministic lifecycle fixture. It does not measure a real repository and its
numbers are not a product baseline.

The controller runs three to five isolated cold executions and one persistent
warm execution. Every fixture process and its child shell run inside the
crash-safe small-tier supervisor defined by
[ADR-014](../../docs/decisions/014-crash-safe-resource-supervision.md). Warm-up
observations are retained as evidence but excluded from statistics. Warm p90
and p95 require exactly 30 measured observations in v1; cold series report
every one of their 3–5 samples, median, and maximum, with no cold p95.

## Reproduce the default scenario

Requirements are the same as the Linux production adapter in ADR-014: a user
systemd manager, delegated cgroup-v2 memory/PID controllers, and bwrap. No
source edit, downloaded repository, or model is needed.

```bash
npm run test:runtime-benchmark

benchmark_parent="$(mktemp -d)"
npm run bench:runtime -- run \
  --output "$benchmark_parent/default" \
  --cold-runs 3 \
  --warmups 1 \
  --warm-samples 30

npm run bench:runtime -- validate \
  --file "$benchmark_parent/default/result.json"
npm run bench:runtime -- summary \
  --file "$benchmark_parent/default/result.json"
npm run bench:runtime -- cleanup \
  --root "$benchmark_parent/default"
rmdir "$benchmark_parent"
```

The output directory must be a new physical path outside the source repository.
The controller atomically extends an identity-and-digest ownership ledger for
each file it creates. Cleanup descriptor-reads and verifies the exact ledger,
refuses matching-name foreign files as well as symlinks, hard links,
replacements, or omissions, then renames the owned directory to an
identity-checked quarantine before recursive removal. Repeating cleanup after
a successful removal is safe.

## Small validation matrix

Only the bounds below are valid. They change measurement confidence, not the
fixture or safety tier.

| Scenario | Cold runs | Warm-ups | Measured warm samples |
|---|---:|---:|---:|
| Minimum/default | 3 | 1 | 30 |
| Additional cold evidence | 5 | 1 | 30 |
| Additional warm-up evidence | 3 | 3 | 30 |

Use the same command as above with the corresponding numeric options. This
issue intentionally provides no medium or large mode.

## Result and raw evidence

`result.json` conforms to
[`result.schema.json`](schema/result.schema.json), schema
`lamina.runtime-benchmark-result/v1`. `summary.md` is a concise rendering, not
an authority. Each execution references and hashes two bounded files:

- `raw/*.json`: the complete `lamina.safe-runner-report/v1` record;
- `telemetry/*.json`: bounded cgroup CPU and I/O samples used by the harness.

The validator requires the artifact root, verifies every physical ancestor,
descriptor-reads both single-link files with `O_NOFOLLOW`, enforces a 2 MiB
raw-report cap and 128 KiB telemetry cap, checks sizes and SHA-256 digests, and
re-derives the result identity, outcomes, exit state, time,
per-process/aggregate memory, temporary state, monotonic CPU/I/O counters,
fixture metadata and phases, and cleanup. Missing, partial, contradictory,
escaping, symlinked, hard-linked, or statistically invalid evidence is
rejected.

`cgroup_peak_memory_bytes` is the authoritative complete-scope, non-double-
counted memory peak. `aggregate_peak_rss_bytes` is the safe runner's diagnostic
sum of process RSS and may double-count shared pages. `runner_peak_rss_bytes`
is the exact source value copied into the result; v1 requires zero difference
and zero tolerance between that source and its harness copy. This is an
integrity comparison, not a second memory sampler. CPU and I/O are cumulative
cgroup counters when the Linux adapter exposes them; unavailable I/O is
explicitly null with a reason. CPU accounting is required for a valid result.

Outcomes remain distinct: `success`, `safe_refusal`, `timeout`, `cancellation`,
`limit_hit`, `command_failure`, and `internal_error`. Only a complete set of
successful executions with verified cleanup is publishable as `status: valid`.
A safe-runner preflight refusal produces `status: refused`; other incomplete
or failed evidence is `status: invalid`.

## Fixture contract

The manifest declares the complete tracked fixture closure, including its
shared validator and physical-read contract, plus one indexed data file and
one child process. Its digest, source and indexed bytes, and nonblank source LOC
are copied into every raw fixture record and revalidated against the result.
The canonical phase order is doctor/status, startup, observation, retrieval readiness,
preparation, no-op sync, incremental change, rebuild, idle, shutdown, and
cleanup. Cold runs measure all phases inside separate scopes. The warm run
creates one state identity, performs explicit discarded warm-ups and measured
operations against it, then records the remaining lifecycle phases once before
scoped cleanup.
