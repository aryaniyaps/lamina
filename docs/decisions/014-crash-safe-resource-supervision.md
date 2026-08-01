# ADR-014: Supervise resource-intensive work with Linux cgroup scopes

## Status

Accepted

## Date

2026-08-01

## Context

Lamina observation, retrieval, packaging, and benchmark commands may create
workers or detached descendants. Measuring or limiting only the direct CLI
process can miss most of their memory, process, output, and cleanup cost. A
runaway descendant must fail a scenario without making the development host
unusable, and an emergency host-safety limit must never be reported as product
performance.

The practical-runtime program targets ordinary developer machines. Its first
enforcement implementation is Linux, where cgroup v2 can account for and stop
an aggregate descendant tree. macOS and Windows do not expose the same
mechanism and require separate native adapters.

## Decision

Run every resource-intensive practical-runtime command through the repository
safe runner. The public Node API is
`scripts/safe-runner/index.mjs`; the canonical CLI is `npm run safe:run`.

On Linux, create a transient user-systemd scope with cgroup-v2 memory and PID
controllers. A one-process POSIX shell gate enters the scope first and does not
release the payload until the controller has observed the exact gate PID in
the expected cgroup and read back the exact `memory.max`, `memory.high`, and
`pids.max` values. A second gate proves a size-limited private tmpfs before the
payload starts. This prevents an unbounded payload from running during a
scope-discovery race. The shell gate avoids consuming a second Node/V8 thread
pool because cgroup `TasksMax` counts threads as well as processes.

The runner:

- derives the hard memory ceiling as `min(3 GiB, 25% of physical RAM)`, with
  the 8 GB profile capped at 2 GiB and a mandatory 2 GiB host reserve;
- applies `MemoryHigh`, `MemoryMax`, and `TasksMax`, then also samples the
  aggregate cgroup and individual `/proc` records;
- keeps bounded samples, diagnostic tails, stdout/stderr files, and
  runner-owned temporary state;
- separates summed process RSS from authoritative cgroup memory accounting;
- runs the payload under unprivileged bwrap with a read-only host root and a
  hard-cap private tmpfs, sampling allocated blocks and inodes through `/proc`;
- terminates the complete scope on memory, PID, timeout, output, temporary
  disk, controller signal, or detached-descendant failure;
- identifies processes by PID plus Linux start ticks so stale records cannot
  target a reused PID;
- lets the graph client register a graphd by that exact identity, then verifies
  graceful daemon/socket cleanup after the payload exits; all unknown detached
  descendants remain safety failures;
- writes an atomic `lamina.safe-runner-report/v1` report for success, command
  failure, refusal, limit, interruption, and internal failure;
- starts a detached, token-disarmed watchdog before payload launch; it holds
  controller and payload PID start identities, the exact scope/cgroup,
  registered graphd paths, dev/inode-bound temporary ownership, the production
  lock identity, and a report seed, so controller `SIGKILL` still produces
  bounded cleanup and a schema-valid `controller_crashed` report;
- refuses a result when cleanup, scope removal, temporary cleanup, or report
  validation cannot be proven; and
- accepts only reviewed internal entrypoints and rejects unknown indirection or
  Docker/Podman/Harbor-style external-daemon execution because descendants
  launched by an external daemon are not proven members of the client scope.

The scoped Lamina CLI may start its normal detached `graphd`, but only through
an online supervisor-broker registration. The runner matches the registered
  PID and Linux start ticks to an in-scope process whose actual interpreter
  script is a content-matched `server.mjs`, or whose exact argv is `--graphd`, owns
its descendants through the same cgroup, and gracefully terminates the scope
after the CLI payload exits. Any unregistered or mismatched remainder keeps the
ordinary detached-descendant failure semantics.

Medium and large runs require all of the following: aggregate enforcement, a
current host-bound adversarial attestation, successful smaller-tier promotion
  for the same explicit workload identity, child-command digest, referenced
  file digest, and bounded Git source snapshot, and the single host-global production
lock (which cannot be redirected with the evidence-state override). Every tier refuses a pre-existing
Lamina runtime because it cannot be adopted into the new scope.
Attestation identity covers the machine, adapter/controllers, architecture,
boot ID, kernel release, systemd/user-manager identity, root controller and
subtree state, and a digest of the runner, graphd integration, schemas, and
adversarial fixture.

Before launch, a durable retry ledger stores bounded per-run files in direct
command/build shards for the active repository, command, referenced workload file identities, runner build, and fixed
concurrency. It is cleared only after a classified result and verified cleanup.
A safety-limit observation converts that entry to a durable fence; changing
limits alone does not permit a retry. Later cleanup failure or controller death
cannot erase or overwrite prior fences. Concurrent small runs cannot overwrite
one another, direct shard lookup avoids a global ledger scan, and later distinct
failures never evict an earlier fence.

Normal completion writes the report before disarming the watchdog. On an
abrupt controller exit, the watchdog validates every systemd operation and
requires the exact transient unit to be absent before reporting scope removal.
It never treats an empty cgroup alone as proof of collection and never follows
a symlink or deletes a same-prefix directory without its captured device/inode
identity.
Managed graphd cleanup additionally derives the exact Git-common runtime from
the graph root and rechecks the runtime directory device, inode, and owner
before removing only physical `graphd.sock`, `graphd.lock`, or
`graphd.operation.lock` entries. Deletion
also requires the graphd lock's PID and Linux start ticks to match the registered
child identity. A child-owned operation lock is atomically replaced by a live
watchdog cleanup claim before deletion; a concurrently starting replacement
either owns that claim first or is refused, so canonical paths alone never
establish deletion authority.

When aggregate enforcement is unavailable, the portable process-group adapter
may execute only the exact built-in self-test fixture/mode allowlist under
strict low maxima. It can exercise refusal and cleanup behavior but cannot
produce an attestation that qualifies medium or large work. Production-grade
macOS and Windows enforcement remains part of issue #57.

## Alternatives considered

### Per-process `ulimit`

Rejected. A parent and several children can remain individually below a limit
while exceeding the safe aggregate budget. It also does not provide durable
descendant ownership or aggregate events.

### Process groups as the production boundary

Rejected. Process groups are useful for deliberately tiny fallback tests, but
a child can create a new session or become reparented. They cannot prove
complete production ownership.

### Poll a normal temporary directory

Rejected. Directory sizes miss deleted-but-open files, can follow symlink
escapes incorrectly, and make inode storms turn the safety monitor itself into
unbounded work. The private tmpfs supplies the hard byte quota; constant-size
`statfs` accounting plus a bounded no-follow walk supplies diagnostics and
inode/symlink refusal. Hosts without unprivileged bwrap tmpfs support refuse
production qualification.

### Launch the payload before discovering its cgroup

Rejected. Even a short discovery race lets the unbounded command start before
the controller knows which scope to sample or stop.

### Use a Node process as the scope gate

Rejected after a real low-limit test. The gate's V8 threads consumed the
`TasksMax=8` fixture budget and caused a normal payload to trip the PID limit.
A shell gate provides the same handshake with one process.

### Require Docker or a benchmark daemon

Rejected. Lamina's runtime is standalone, and a client-side cgroup cannot
prove ownership of descendants created by an external daemon.

## Consequences

- Later practical-runtime issues have one canonical command and one versioned
  report contract for all resource-intensive work.
- Safety-limit outcomes are explicit failed scenarios and cannot be promoted
  or used as performance measurements.
- Promotion state is repository-source-, workload-, child-command-, referenced-implementation-, and runner-build-specific;
  changing the runner invalidates prior attestation and promotion evidence.
- Linux low-limit CI must produce a production-qualified adversarial
  attestation. macOS and Windows CI exercise the portable interface and
  production-refusal contract without claiming enforcement.
- macOS and Windows cannot claim medium/large qualification until issue #57
  supplies and tests complete native descendant enforcement.
