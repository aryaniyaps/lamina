# Real-repository runtime baseline v1

## Status

Blocked on 2026-08-02. No latency, memory, footprint, or cardinality value from
the attempted runs is an accepted baseline measurement.

The harness and its safety boundary are implemented, but the published
`cli-v0.3.5` Linux x64 worker and the available safely enforceable hosts have no
compatible intersection:

- Ubuntu 22.04 passes the complete adversarial safe-runner qualification, but
  the worker requires `GLIBC_2.38`; Ubuntu 22.04 provides an older glibc.
- Ubuntu 24.04 provides a compatible glibc, but a downloaded rootless
  bubblewrap executable is denied by the host's user-namespace policy. The
  hosted image does not provide `/usr/bin/bwrap` for the distribution policy to
  authorize.
- The local Linux host now provides glibc 2.43, production cgroup-v2
  enforcement, and working rootless user/private-tmp namespaces. Full #59
  qualification still refuses before payload release because its isolated
  network namespace cannot configure loopback (`RTM_NEWADDR` is denied by the
  host policy).

Medium and large were not dispatched. That is intentional: #59 requires a
successful small run and verified descendant cleanup before promotion.

## Pinned inputs

| Tier | Repository | Commit | Declared source class | Languages | Measured inventory |
| --- | --- | --- | --- | --- | --- |
| Small | `alan2207/bulletproof-react` | `9506629ed003a561c6627735480cce4994244bb4` | 10k-50k nonblank tracked source LOC | TypeScript, React | Blocked before fixture preparation |
| Medium | `outline/outline` | `30730179b852d42da5078a9294f7d05a44f516b7` | 100k-300k nonblank tracked source LOC | TypeScript, React | Not run |
| Large | `makeplane/plane` | `dc9d80b2d2a499b967f0b541e083b283f463719f` | Realistic polyglot monorepo | TypeScript, React, Python | Not run |

The runtime inputs are the published `cli-v0.3.5` assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `lamina-cocoindex-worker-linux-x64` | 88,690,440 | `119247359266f2a5b922b03c76d052bc76d757ec634593fbf52473bfc8ee79cc` |
| `lamina-retrieval-model-int8-v1.onnx` | 161,895,621 | `ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d` |

The manifest is authoritative for repository URLs, exclusion rules, file
allowlists, LOC ranges, file-size ceiling, and asset URLs.

## Execution evidence

| Environment | Safe-runner result | Workload result | Cleanup | Evidence |
| --- | --- | --- | --- | --- |
| GitHub Ubuntu 22.04, 16 GiB, head `541d1726` | Full production qualification passed | Small `footprint` failed while extracting the pinned worker: its bundled Python required `GLIBC_2.38` from `libm.so.6` | Zero remaining descendants and managed paths; scope and temporary directory removed; orphan scan empty | [Actions run 30725039365](https://github.com/aryaniyaps/lamina/actions/runs/30725039365) |
| GitHub Ubuntu 24.04, 16 GiB, head `2d39cc1b` | Refused before qualification: downloaded bubblewrap could not create its UID map | Not released | Cleanup verification passed; orphan scan empty | [Actions run 30725180790](https://github.com/aryaniyaps/lamina/actions/runs/30725180790) |
| GitHub Ubuntu 24.04, head `0a56cc94` | System bubblewrap authority was unavailable because `/usr/bin/bwrap` is absent | Not released | Orphan scan empty | [Actions run 30725277619](https://github.com/aryaniyaps/lamina/actions/runs/30725277619) |
| Local Linux x64, glibc 2.43, head `01db8b18` | Production adapter detected; user namespace and quota probe passed; full #59 qualification refused because bubblewrap could not configure loopback in the isolated network namespace: `Failed RTM_NEWADDR: Operation not permitted` | Not released | All ten bounded qualification reports recorded sandbox-launch failure; zero descendants and managed paths remained; temporary directory, watchdog directory, lock, and systemd scope were absent | `LAMINA_SAFE_RUNNER_STATE_DIR=/tmp/lamina-issue60-recheck-safe-state npm run safe:self-test -- --require-production` |

The Ubuntu 22.04 artifact contains a schema-valid invalid result for small
`footprint`, its raw safe-runner report, the passing self-test reports, and an
empty orphan file. The other eleven small scenarios are explicitly recorded as
blocked after the first failure. Failure-scope peaks are diagnostics only and
must not be used as baseline measurements.

## Rejected bypasses

- Running outside #59 or without aggregate process-tree enforcement.
- Retrying after removing or increasing safety limits.
- Adding swap or changing host/kernel memory or namespace behavior.
- Patching the worker's ELF interpreter, adding a loader wrapper, or substituting
  an unpinned worker; each would measure a different runtime.
- Promoting medium or large after the failed small scenario.

## Safest unblock

Publish a checksum-pinned Linux x64 worker built from the same runtime sources
against the oldest supported glibc (at most glibc 2.35), then update only the
manifest's published asset identity and repeat the full small run. The alternative
is a trusted host that simultaneously provides glibc 2.38 or newer, user-systemd
cgroup-v2 aggregate enforcement, quota-backed private temporary storage, and a
policy-authorized rootless bubblewrap whose isolated network namespace passes the
full #59 adversarial qualification. In either case, rerun the complete #59
self-test before releasing the fixture and preserve small-to-medium-to-large
promotion order.
