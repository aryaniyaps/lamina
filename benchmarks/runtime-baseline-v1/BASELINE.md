# Real-repository runtime baseline v1

## Status

Recorded through the first enforced safety refusal on 2026-08-02. Re-validated on
2026-08-03 at Lamina commit `104153a1` (post-PR #66 merge) with the same
outcome: the small fixture produced valid footprint and cold doctor/status/startup
results, then its initial observation reached the unchanged aggregate
`pids.max=64` ceiling, so that scenario remains invalid and every later scenario
and tier is explicitly blocked.

Post-#53–#77 re-measurement at `d94f8bdd` (see
[`runtime-qualification-v1/QUALIFICATION.md`](../runtime-qualification-v1/QUALIFICATION.md)):
footprint and doctor/status remain valid; `initial-observation` promotion now
succeeds but cold sample isolation fails with `preflight_refused` when graphd
from the prior sample has not stopped. The PID-limit peaks in the 2026-08-02/03
runs are safety diagnostics, not performance samples.

This is the truthful unoptimized baseline. The harness measures the public CLI
commands and does not alter Lamina's stores, model, worker topology, batching,
chunking, exclusions, or quality thresholds. Raising the PID limit or bypassing
the safe runner would answer a different and unsafe question. Issue #51 owns the
measured task-concurrency bottleneck.

## Pinned inputs

| Tier | Repository | Commit | Declared source class | Languages | Result |
| --- | --- | --- | --- | --- | --- |
| Small | `alan2207/bulletproof-react` | `9506629ed003a561c6627735480cce4994244bb4` | 10k-50k nonblank tracked source LOC | TypeScript, React | Promoted; stopped at initial observation |
| Medium | `outline/outline` | `30730179b852d42da5078a9294f7d05a44f516b7` | 100k-300k nonblank tracked source LOC | TypeScript, React | Not dispatched: small did not complete |
| Large | `makeplane/plane` | `dc9d80b2d2a499b967f0b541e083b283f463719f` | Realistic polyglot monorepo | TypeScript, React, Python | Not dispatched: small did not complete |

The runtime inputs are the published `cli-v0.3.5` assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `lamina-cocoindex-worker-linux-x64` | 88,690,440 | `119247359266f2a5b922b03c76d052bc76d757ec634593fbf52473bfc8ee79cc` |
| `lamina-retrieval-model-int8-v1.onnx` | 161,895,621 | `ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d` |

The versioned manifest remains authoritative for repository URLs, exclusion
rules, file allowlists, LOC ranges, file-size ceiling, and asset URLs.

## Qualified execution environment

| Field | Value |
| --- | --- |
| Lamina commit | `104153a10f71a613fcd3ac9cc6b9aff26aa104d7` |
| Host | Linux x64, kernel `7.0.0-28-generic`, Intel Core Ultra 9 185H |
| Memory | 65,562,333,184 bytes |
| Runtime | Node `v24.18.0`; glibc `2.43` |
| Sandbox | `/usr/bin/bwrap`, 80,424 bytes, SHA-256 `0abea81db798ebf6b4742ac0664802d97521547a353c2a0dbdc21d76cbbfd2c0`, root-owned, one link, no file capabilities |
| Enforcement | user-systemd cgroup v2, aggregate memory/PID ownership, private quota-backed tmpfs, isolated network/PID/user namespaces |
| Hard limits | memory 3 GiB, high 2.4 GiB, 64 tasks, 30 minutes, 1 MiB output, 2 GiB temporary data, 8,192 temporary inodes |

Immediately before measurement, the complete production adversarial command

```sh
LAMINA_SAFE_RUNNER_STATE_DIR=/tmp/lamina-runtime-baseline-safe-state \
  npm run safe:self-test -- --require-production
```

passed all cases. It proved direct and aggregate memory enforcement, PID,
timeout, output, temporary-disk, controller-signal, supervisor-SIGKILL,
detached-descendant, and exact cleanup behavior. Every case reported
`cleanup_verified: true`; the latest attestation time was
`2026-08-03T16:12:26.308Z`.

The host path for the root-owned distribution bwrap is intentional. Ubuntu's
path-based AppArmor policy recognizes the distribution executable but not a
byte-identical temporary copy. ADR-014 records the root-ownership, ancestry,
mode, inode, digest, link-count, and empty-file-capability requirements. Pinned
or user-owned bwrap inputs still execute from sealed copies.

## Small fixture inventory

| Measure | Value |
| --- | ---: |
| Tracked files | 535 |
| Tracked bytes | 2,640,087 |
| Tracked source files | 438 |
| Tracked source bytes | 628,504 |
| Tracked nonblank source LOC | 20,450 |
| Observation candidate files / bytes | 535 / 2,640,087 |
| Retrieval candidate files / bytes | 467 / 693,785 |
| Source CLI files / bytes | 34 / 89,144,519 |
| Prepared runtime files / bytes | 4 / 5,950,249 |
| Sealed model bytes | 161,895,621 |
| Sealed worker bytes | 88,690,440 |

Excluded roots are `.git`, public agent-skill mirrors, Lamina runs/runtime state,
`node_modules`, Python caches and virtual environments, `.next`, `dist`,
`build`, `coverage`, benchmark results, and vendored eval temporary trees. The
observation path-set digest is
`a751c5ae498aad42ec231daf714f8bede3e76f1d6f083ccbe3b6097f666b07cc`;
the retrieval path-set digest is
`8915cb111c9232dd2645d5b470e95fcfddc8a2293f4cc6881a9727c52864d52b`.

## Valid measurements

All three cold samples include public CLI startup, argument parsing, dispatch,
and graphd startup. Nanosecond values are reported as milliseconds below for
readability; the JSON retains exact integer nanoseconds.

| Scenario | Samples | Median | Maximum | Aggregate run envelope |
| --- | --- | ---: | ---: | --- |
| Installation/extracted footprint | static | n/a | n/a | 6,069 ms; 404,770,816-byte cgroup peak; 33-task peak; cleanup zero |
| Doctor/status and graph startup | 459.175, 462.817, 430.490 ms | 459.175 ms | 462.817 ms | 6,403-6,800 ms; 403,865,600-405,061,632-byte cgroup peaks; 46-56-task peaks; cleanup zero |

Doctor itself took 56.699-71.994 ms. Status plus cold graphd startup took
373.732-397.216 ms. These are three cold samples, so no p90 or p95 is claimed.

## Enforced refusal and promotion fence

| Scenario | Status | Evidence |
| --- | --- | --- |
| Initial observation | Invalid: aggregate PID safety limit | 11,346 ms to stop (2026-08-03 re-run); 64-task sampled peak; 717,111,296-byte cgroup diagnostic peak; SIGTERM requested; zero descendants and managed paths; scope and temporary directory removed |
| Initial retrieval readiness | Blocked after previous failure | Not released |
| First useful preparation | Blocked after previous failure | Not released |
| Warm preparation | Blocked after previous failure | Not released |
| No-op synchronization | Blocked after previous failure | Not released |
| One-file / multi-file change | Blocked after previous failure | Not released |
| Full derived-state rebuild | Blocked after previous failure | Not released |
| Post-command idle RSS | Blocked after previous failure | Not released |
| Cancellation/shutdown/orphans | Blocked after previous failure | Covered only by the preceding production qualification, not claimed as a product-baseline result |
| Medium / large | Blocked by small-tier promotion fence | Never dispatched |

The bounded descendant diagnostics identify overlapping native/runtime demand:
the asset-extraction worker reached 45 threads, graphd 29, the public CLI 7, and
the observation worker 17 before the controller stopped the scope. These maxima
are sampled per-process diagnostics and are not assumed to be simultaneous.
They nominate concurrency control as a bottleneck without selecting an
architecture.

## Result identity and reproduction

The schema-valid local result set from the original 2026-08-02 run is preserved at
`/tmp/lamina-runtime-baseline-small-20260802-r29` on the qualifying host. Its
index SHA-256 is
`658420c27ff3d6c85af7c439173cb6bdbf0756afc894b99bb6344360abe24801`.

The 2026-08-03 post-#66 re-validation result set is at
`/tmp/lamina-runtime-baseline-small` on the same host. Its index SHA-256 is
`bababbe1692c809c837e43e48cf1cdf645422ecf6375f6296f1774f6c2f3b66e`.
Raw safe-runner report digests from that re-run are:

- footprint: `b21f9adae9551ad4e2583f123e700fcc66e13a84170b482c48888aeb45d32651`;
- doctor/status samples: `b7956e19f478d277fc2cdd327e34a791d00fadc9da3884c21e40256e61a096a5`, `463c977d330681e069afe49c30d46fc2528c9687dd766d9a3a488789ed17b144`, and `feda78e255e88022c19f3c32ef9c90bb70982dd36af4ba71e2469e66fc897dd0`;
- initial-observation refusal: `c2da297a1e07018a4398283b43eb3a09eb45ef0397c4dc4064521e9346cbb2bf`.

After downloading the two checksum-pinned assets to the paths shown below, a
compatible Linux host can reproduce the run without source edits:

```sh
LAMINA_SAFE_RUNNER_STATE_DIR=/tmp/lamina-runtime-baseline-safe-state \
  npm run safe:self-test -- --require-production

LAMINA_SAFE_RUNNER_STATE_DIR=/tmp/lamina-runtime-baseline-safe-state \
  node benchmarks/runtime-baseline-v1/run.mjs run \
    --fixture small \
    --output /tmp/lamina-runtime-baseline-small \
    --model dist/runtime-baseline-inputs/model.onnx \
    --worker dist/runtime-baseline-inputs/cocoindex-worker
```

The second command exits 2 because the index truthfully contains an invalid
safety-limited scenario. Repeating it requires a fresh output directory; it
must not be retried with raised limits. A compatible host must provide cgroup-v2
aggregate enforcement, a quota-backed private temporary filesystem, and a
policy-authorized unprivileged bwrap. Medium and large remain forbidden until a
small run completes after a reviewed runtime improvement.

## Historical host refusals

- [Ubuntu 22.04 run 30725039365](https://github.com/aryaniyaps/lamina/actions/runs/30725039365)
  passed production qualification but could not load the pinned worker because
  it requires `GLIBC_2.38`.
- [Ubuntu 24.04 run 30725180790](https://github.com/aryaniyaps/lamina/actions/runs/30725180790)
  had a compatible glibc but its downloaded bwrap was denied a UID map.
- [Ubuntu 24.04 run 30725277619](https://github.com/aryaniyaps/lamina/actions/runs/30725277619)
  had no policy-authorized `/usr/bin/bwrap`.

These failures remain useful portability evidence but are not measurements.
