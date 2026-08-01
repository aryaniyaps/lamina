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
  paths before spawn, hold the exact in-scope child behind a broker start gate,
  persist creation authorization before release, and seal exact object
  identities after readiness and lock-PID validation;
- acquires the report slot by atomically replacing it with a current-run
  non-success provisional, never by truncating a symlink or hardlink target,
  then advances exact single-link inode generations for completed outcomes;
- places the audited executable, complete Git-owned source tree, explicit file
  argv inputs, and bounded resolved dependency roots in a runner-owned
  read-only execution snapshot before launch; repository-output entrypoints are
  refused rather than rebound to live source, while only the exact Git-common
  `lamina/work` fixture scratch contracts remain mutable;
- refuses a result when cleanup, scope removal, temporary cleanup, or report
  validation cannot be proven; and
- rejects Docker/Harbor-style external-daemon execution because descendants
  launched by an external daemon are not proven members of the client scope.

Managed `graphd` authority is not available to ordinary workloads. It is
retained only for the deliberately tiny graphd-client fixture beneath the exact
Git-common `lamina/work` scratch tree and for the standalone CLI smoke fixture's
child-cwd repository inside private payload tmpfs. The broker first proves the
fixture socket and lock absent and durably reserves them. Only then may the
fixture spawn a paused graphd and bind the reservation to its host/namespace
PIDs plus Linux start ticks. The standalone form additionally requires the
reservation runtime to equal the attested child's `<cwd>/.git/lamina`; it
cannot reserve the source repository's Git-common paths. The broker
persists an `authorized` managed-path generation before releasing the child;
graphd rechecks both names absent and refuses rather than unlinks a replacement.
Graphd's reservation-bound lock proves the narrow object-creation transition;
the watchdog can clean that exact valid lock even if the controller dies before
socket creation. After readiness the broker
records exact device/inode/owner/type identities and validates the lock PID.
Normal and watchdog cleanup share the same `lstat`-based immediate pre-unlink
identity recheck. Dangling symlinks, unsealed foreign objects, and same-user
replacements remain in place and keep cleanup incomplete.
The proof socket itself has a hard concurrent-connection cap, idle and frame
byte deadlines, exactly one request per connection, and a bounded fixed-window
request rate. Its deadline remains armed after a response until the connection
closes, so clients withholding FIN cannot retain all accepted slots. These limits keep proof work performed by the controller outside
the payload cgroup from becoming an unbounded resource surface.

Medium and large runs require all of the following: aggregate enforcement, a
current host-bound adversarial attestation, successful smaller-tier promotion,
for the same explicit workload identity, and the single host-global production
lock (which cannot be redirected with the evidence-state override). Every tier refuses a pre-existing
Lamina runtime because it cannot be adopted into the new scope.
Attestation identity covers the machine, adapter/controllers, architecture,
boot ID, kernel release, systemd/user-manager identity, root controller and
subtree state, and a digest of the runner, graphd integration, schemas, and
adversarial fixture.

After creating the runner-owned outer directory, the controller starts its
independent watchdog before copying any workload bytes. A controller crash
during construction therefore removes partial execution authority even though
no scope or payload exists yet. The runner then descriptor-copies the workload
into private execution authority. Its manifest uses stable logical labels rather than random snapshot
paths, rejects escaping symlinks, and applies file/byte bounds. Static local
imports use the copied Git tree; bare packages are copied from the audited
import closure and resolve from each importer's nearest in-repository package
boundary, with explicit dependency contracts for non-standard resolvers.
Each distinct physical package root is copied once into a bounded private
store. Synthesized relative links reproduce the exact package selected for
each root and parent, including incompatible nested versions, installed
optional/platform packages, and required peers. Missing required peers refuse;
missing optional packages remain absent. Source package-manager links may only
resolve to physical roots beneath repository `node_modules`, and every emitted
link terminates inside the sealed store rather than retaining live authority.
An npm alias keeps its declared logical link name while the physical manifest
must match the parsed alias target, including scoped targets; malformed aliases
refuse. npm's `optionalDependencies` precedence over a same-name `dependencies`
entry is preserved, including when the override changes an alias target.
Package manifests are descriptor-read with a one-MiB ceiling. Both the copy
walker and the separate metadata-only closure walker stream directory entries
and enforce depth 64. The inode budget includes copied files and symlinks plus
every created store, `node_modules`, scoped-parent, package, and logical-link
inode; the diagnostic models the same synthetic resolution overhead.

`npx` is not a package-level allowlist. It recognizes only the exact argv tails
of `test:eval:portable` and `test:eval:redteam`, run from the physical repository
root through the trusted npx shim. Recognition and launch admission are
separate contract fields. The copied `package.json` and physical config must
retain the descriptor-read digests used to select policy. Agent-skills is
recognized but `launch_admitted: false` because its generated ignored input and
copy-on-write workspace lack sealed same-filesystem hard-quota authority.
Promptfoo remains `launch_admitted: false`, digest-bound to
`9033e19f151b29d8fbc5d6739d5941692ed7f923456c95906d67a00492e1b194`
and the exact CLI adds `--max-concurrency 1`. That OpenAI-only config permits
omission of Promptfoo's direct optional provider/plugin dependencies only;
required dependencies and installed downstream optional/platform dependencies
remain in its metadata policy. Preflight always returns the contract's
actionable authority-budget refusal, and direct snapshot preparation enforces
the same fence before dependency availability or size can matter. Thus clean CI
does not need Promptfoo installed to prove the refusal. A local qualification
install measured the narrower diagnostic at 445 packages, 30,356 physical
package-content inodes, and 555,525,917 bytes before synthetic resolution
overhead. Those numbers are supporting local evidence, not the CI gate. They
exceed both the global 16,384-inode and 512-MiB caps; enabling launch requires a
future reviewed bounded artifact, not a cap increase or silent pruning.
Ignored file argv inputs (for example model artifacts) are copied separately.
Repository outputs are not live writable bindings. Build, retrieval-asset,
compatibility, eval workspace, and vendor-fixture writers are refused during
preflight and again by direct snapshot construction. The only retained mutable
argv-output contracts are the graphd-client and mutable fixtures beneath the
exact Git-common `lamina/work` scratch authority.

Retrieval `--evaluate` and `--calibrate` are semantic-authority contracts, not
generic argv. Each requires exactly one explicit `--worker`, `--model`,
`--tokenizer`, and lowercase 64-hex `--model-digest`; both modes together,
duplicates, assignment forms, environment-only inputs, uv fallback, and
external or symlinked paths refuse. All three paths must have canonical
physical same-user, single-link repository ancestry, and the worker must be
executable. The model's digest and byte size must match both its physical bytes
and `packages/cli/retrieval-model-manifest.json`. The tokenizer has no separate
manifest pin in this decision; its descriptor-copied bytes are bound into the
frozen and execution-snapshot digests. A dedicated retrieval identity excludes
these recognized path-value positions from the generic 64-MiB argv-input cap,
then records the bounded worker/model/tokenizer identities and manifest
authority directly. This admits the canonical 161,895,621-byte model without
raising the global cap. Small evaluation is the exact promotion precursor for
the same normalized medium command.

Atomic publication is also refused in issue #59. Correct rename-based
publication requires its stage and saved-old objects to share the target's
filesystem. The payload's hard temporary quota is a different private tmpfs,
while sampled usage on a host-filesystem staging area is observation rather
than hard enforcement. This issue does not weaken the hard-quota invariant to
make publication fit. A future owning leaf may add publication only with a
proven same-filesystem hard quota or a separately reviewed revision to this
accepted contract. The standalone prototypes in checkpoints `339f5d12`,
`1e85392b`, and `5bcba5f0` were rejected from final integration for this
structural quota conflict, not retained as a dead API.

For linked worktrees, the descriptor-copied `.git` pointer remains in the
frozen worktree. A bounded pack containing the reachable HEAD ancestry plus
index objects, copied common config/ref metadata, and copied worktree HEAD/index
are mounted read-only at the original absolute common/worktree Git paths.
The original common `lamina` directory is not rebound for ordinary workloads;
only the two small scratch fixtures receive that entrypoint-specific binding.
Object alternates and config includes are never admitted. Inherited `GIT_*`
controls are removed, while
system and global Git config reads are deterministically disabled.
The same authority descriptor-copies Node, bwrap, the gate scripts, and the
sandbox launcher/import before systemd launch. The shell and systemd launcher
remain host-trusted infrastructure; bwrap and later stages execute their staged
objects, so a post-validation pathname swap cannot choose the sandbox binary.
Large ignored runtimes are not silently exposed again after the repository
mount. In particular, eval-suite `.venv-eval` execution is refused with an
actionable bounded-runtime requirement. Retrieval qualification has no uv or
environment fallback. Test-only `LAMINA_TEST_*` controls are stripped from
non-self-test payloads; retrieval semantic environment families are stripped
before the benchmark and only descriptor-copied native/smoke inputs are
reintroduced for those separate entrypoints. The two graphd fixture forms also
require kernel-observed executable inode/owner identity and exact argv. A
process-title or `--graphd` argv spoof cannot qualify.

Immediately before release the runner revalidates both its frozen preflight
identity and execution snapshot and writes a durable active-attempt fence. The identity covers the complete
normalized argv, the exact bounded content-hashed executable object, every
ordinary file argument resolved against the supplied cwd, the dedicated
manifest-bound retrieval semantic identity when applicable, the
content-hashed Git snapshot, and runner build. Effective limits are excluded.
The frozen identity is reused after execution, so payload source mutation cannot
change which attempt is recorded or promoted. The full identity is checked
again immediately before the inner quota gate releases the payload. The active fence is cleared only
after a non-limit success/command failure has a trustworthy final report and
proven watchdog disarm. A limit or controller crash retains it.
Tier promotion is rechecked only after snapshot construction and binds the
source identity to the execution-snapshot digest. A small run using dependency
or staged-tool bytes A therefore cannot qualify a medium run that discovers
bytes B under otherwise identical argv and Git source.

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
- Repository-output workloads refuse before watchdog, snapshot, or payload
  authority. Enabling one requires a proven same-filesystem hard quota or a
  separately accepted contract revision; sampled host usage is insufficient.
