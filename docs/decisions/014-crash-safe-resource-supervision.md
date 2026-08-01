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
  hard-cap private tmpfs, isolated PID namespace, masked systemd/D-Bus/container
  control sockets, and an isolated network namespace for offline entrypoints;
- admits only audited repository entrypoints from a physical Git worktree and
  refuses arbitrary wrappers, loader/eval indirection, symlink substitution,
  host-sensitive writable roots, and runner-state overlap;
- arms an independently owned exact-unit watchdog before payload release so a
  supervisor `SIGKILL` still proves scope, managed-path, temporary-directory,
  and nonce/inode-bound production-lock cleanup;
- resolves `systemd-run`, `systemctl`, bwrap, Node, and the shell from persisted,
  launch-rechecked host identities (including absolute SHA-pinned CI bwrap) and
  strips PATH plus loader/Node/exported-function/runtime-hook families before any
  infrastructure process starts;
- terminates the complete scope on memory, PID, timeout, output, temporary
  disk, controller signal, or detached-descendant failure;
- identifies processes by PID plus Linux start ticks so stale records cannot
  target a reused PID;
- lets the graph client durably reserve absent canonical graphd socket/lock
  paths before spawn, bind that reservation to the exact in-scope child, and
  seal exact object identities after readiness and lock-PID validation;
- invalidates the report slot with a current-run non-success provisional before
  lengthy preparation, then
  atomically replaces that run-bound slot for every completed outcome;
- refuses a result when cleanup, scope removal, temporary cleanup, or report
  validation cannot be proven; and
- rejects Docker/Harbor-style external-daemon execution because descendants
  launched by an external daemon are not proven members of the client scope.

The scoped Lamina CLI may start its normal detached `graphd`, but only through
an online three-phase supervisor-broker protocol. The broker first proves the
canonical socket and lock absent under a physical same-user parent and durably
reserves them. Only then may the client spawn graphd and bind the reservation
to its host/namespace PIDs plus Linux start ticks. Graphd's reservation-bound
lock proves the narrow object-creation transition; after readiness the broker
records exact device/inode/owner/type identities and validates the lock PID.
Normal and watchdog cleanup share the same `lstat`-based immediate pre-unlink
identity recheck. Dangling symlinks, unsealed foreign objects, and same-user
replacements remain in place and keep cleanup incomplete.

Medium and large runs require all of the following: aggregate enforcement, a
current host-bound adversarial attestation, successful smaller-tier promotion,
for the same explicit workload identity, and the single host-global production
lock (which cannot be redirected with the evidence-state override). Every tier refuses a pre-existing
Lamina runtime because it cannot be adopted into the new scope.
Attestation identity covers the machine, adapter/controllers, architecture,
boot ID, kernel release, systemd/user-manager identity, root controller and
subtree state, and a digest of the runner, graphd integration, schemas, and
adversarial fixture.

Immediately before release the runner revalidates its frozen preflight identity
and writes a durable active-attempt fence. The identity covers the complete
normalized argv, the exact bounded content-hashed executable object, every
file argument resolved against the supplied cwd, the
content-hashed Git snapshot, and runner build. Effective limits are excluded.
The frozen identity is reused after execution, so payload source mutation cannot
change which attempt is recorded or promoted. The full identity is checked
again immediately before the inner quota gate releases the payload. The active fence is cleared only
after a non-limit success/command failure has a trustworthy final report and
proven watchdog disarm. A limit or controller crash retains it.

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
- Promotion state is repository-, workload-, complete-argv-, referenced-input-,
  Git-source-snapshot-, and runner-build-specific.
- Linux low-limit CI must produce a production-qualified adversarial
  attestation. macOS and Windows CI exercise the portable interface and
  production-refusal contract without claiming enforcement.
- macOS and Windows cannot claim medium/large qualification until issue #57
  supplies and tests complete native descendant enforcement.
