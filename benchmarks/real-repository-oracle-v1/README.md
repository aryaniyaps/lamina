# Real-repository oracle v1

This benchmark separates repository admission, case discovery, expectation
review, semantic-core grading, and public-CLI qualification. Evidence from an
earlier stage cannot be relabeled as evidence from a later one.

The three repository pins and their inventories are manually reviewed. A
candidate-visible Workflow seed and private expectation candidate are now
digest-bound under an accepted independent-review receipt. That receipt grants
no candidate quality or runtime authority. Consequently `validate` stays
outside the safe-runner exact-command allowlist and the public-CLI mode remains
explicitly safety-blocked. There is no end-to-end or user-runtime qualification
claim.

## Bounded case discovery

`discover-cases` is the bounded discovery entrypoint. It must run through the
safe runner with the exact workload identity:

```bash
node scripts/safe-runner/cli.mjs run \
  --tier small \
  --workload real-repository-oracle-v1:case-discovery \
  --report /absolute/non-repository/report.json \
  -- node benchmarks/real-repository-oracle-v1/workload.mjs discover-cases
```

Use the corresponding tier for `medium` or `large`. The workload first
materializes the immutable pin and verifies it against the reviewed inventory.
It then calls the unchanged production `brownfieldSignals` seam over a bounded
candidate set. Discovery v2 emits a deterministic compact index with at most
three distinct anchors per observed category, stratified across source, test,
docs, and config when those strata are available. Lexical near-neighbors and
same-stratum negative decoys are controls, while modify, rename, delete,
branch, and logical-worktree rows are unexecuted `scenario_before` candidates.
Rename destinations carry an absence proof over the complete stage-0 tracked
path authority plus every implied parent directory in the portable path model,
not merely the filtered discovery set. The proof binds separate counts and
digests for tracked paths and occupied destinations. Proposed names are bounded
root-level canonical-digest identities; only a safe short source extension is
preserved, so a legal source path cannot make its own destination invalid.
Generated and build outputs, including hashed Workbox bundles, are excluded
explicitly. The clean-room path seam also excludes Mock Service Worker runtime
artifacts, dependency lockfiles, agent instruction basenames, dedicated agent
configuration/state directories, and `.github/{agents,instructions}` while
leaving ordinary `.github` content eligible. The legacy
`excluded_generated_artifacts` scan counter is the aggregate count of all these
excluded non-product artifacts; retaining that name avoids a wire/schema churn.
The complete index is encoded as one ASCII line behind the wire-only
`LAMINA_REAL_REPOSITORY_CASE_DISCOVERY_V4` prefix. The V4 transport interns canonical file
and signal facts, uses reference
tuples for categories, controls, and operations, hoists shared rename authority,
and stores digests as canonical base64url raw bytes. It reports expanded-semantic,
packed-transport, and final encoded sizes in its envelope and carries the packed
bytes as canonical unpadded base64url. The packed input is capped at 512 KiB, whose
worst-case base64url representation is 699,051 characters; the complete line,
including its prefix but excluding the final newline, is capped at 768 KiB.
V4 deliberately does not compress: Brotli has no cross-runtime canonical bitstream,
so decoder-side recompression would make otherwise identical reviewer facts depend
on the Node/zlib version. Raw-only framing also removes decompression-bomb and codec
choice ambiguity while staying comfortably inside the workload-specific tail.
The exact case-discovery workload alone receives a 1 MiB retained stdout tail; the
generic safe-runner tail remains 8 KiB and the hard combined-output cap remains
32 MiB. A report is usable only when it is successful and non-truncated, has no
stderr, retains byte-exact whole stdout, contains exactly the V4 line plus one LF,
and independently binds the schema-valid safe-runner report to the audited
`discover-cases` command, reserved workload ID, production scope, source identity,
sealed execution-snapshot identity, decoded collection tier, successful termination,
and complete cleanup. Small reports must prove the no-lock path; medium and large
reports must prove release of their production lock. This decoder does not prove the
separate promotion ledger: callers must verify current promotion authority before a
production-tier run.
Changing this runner or wire changes the runner-build identity and invalidates
earlier promotion. Unit coverage proves the bounds and profile selection first;
fresh adversarial self-test, small promotion, and medium execution must happen
from the reviewed commit before a real greater-than-8-KiB report is accepted as
integration evidence.
Signal values are bounded reviewer previews; `value_sha256` binds the complete
untruncated raw signal and therefore need not equal the preview's digest.
Both encoding and decoding enforce a 512 KiB expanded-semantic ceiling; decoding
projects the exact reference fan-out before materializing the expanded index.
The decoder reconstructs the exact logical discovery object for reviewer use;
that object remains schema V2. A bound transport-contract digest and canonical
semantic digest prevent the wire representation from silently changing or
dropping candidate fields. Non-canonical, malformed, tampered, amplified, or
oversized transports are refused rather than lossily compacted.
The wire does not copy the complete tracked/occupied path sets into stdout;
their reviewed counts and digests remain carried authority, and the semantic
digest binds them exactly. Recomputing those set digests still requires the
sealed materialization that produced discovery.

Discovery output has zero quality claims, cannot load the grader or expectation
contract, and cannot be used directly by `validate`. Its handoff requires an
independent human review before any later fixture or expectation is authored.

## Reviewer-selected evidence expansion

`reviews/evidence-selection-v1.json` is a committed, digest-bound, tier-keyed
selection authority. Independent reviewers selected 8 small, 10 medium, and 12
large bounded anchors; this selection is still explicitly not grade or
expectation authority. Evidence expansion has not yet established those facts.
When that separate stage runs, it uses an exact zero-argument workload command:

```bash
node scripts/safe-runner/cli.mjs run \
  --tier small \
  --workload real-repository-oracle-v1:evidence-expansion \
  --report /absolute/non-repository/report.json \
  -- node benchmarks/real-repository-oracle-v1/workload.mjs expand-evidence
```

The sealed source closure contains the selection file and expansion code but
not the case-discovery code, oracle fixture, evaluator, grader, Workflow
documents, or golden answers. Expansion re-verifies the reviewed inventory and
selected Git blobs, then returns bounded path/blob/content/symbol/line/context
facts with reviewer-requested role and method metadata plus a separate
controller-derived verified method. Exact-identifier evidence must occur at
the declared line, absence evidence must have zero exact matches, and line
context must name an existing line. Missing,
tampered, duplicate, traversing, drifted, or over-budget anchors are refused.
These are lexical Git facts only; they cannot serve as a gold answer or grade.
An absent rename destination cannot be relabeled as blob evidence: selecting
that nonexistent path is refused, while its stage-0 absence proof remains on
the discovery-side rename candidate.
`scenario_after` is deliberately refused here: it requires a later sealed
post-mutation evidence workload and cannot inherit pre-scenario facts.

## Reviewer-selected scenarios

`reviews/scenario-selection-v1.json` is the selection-only handoff from the
audited discovery reports and reviewer-selected lexical evidence. It binds the
baseline manifest, candidate policy, exact repository pins, reviewed inventory
digests, discovery report/semantic/index identities, and current evidence
selection identities. Each tier contains exactly six ordered scenario choices:
clean, modify, rename, delete, branch, and logical worktree. Modify, rename, and
delete use distinct source blobs. Branch and logical worktree deliberately share
one source/pair identity but reserve different future branch names so later
materialization can remain isolated. Every non-clean row preserves its exact
discovery operation kind/index and separately names its authored kind; branch
and logical-worktree rows remain explicitly `executed: false`.

The committed status is `reviewer_selected`. Independent fixture and safety
reviewers accepted the bounded selection. This file is still not an
execution recipe and grants no fixture, expectation, golden-answer, grading, or
quality authority. Its kind-specific records contain no generic operation array,
physical path, environment, Git argument vector, lease, or candidate request.
The parser binds raw and canonical file identities, order-dependent scenario
identities, portable path rules, complete rename-destination absence proofs,
and strict Git ref derivation. Later materialization must consume this exact
reviewed identity and establish its own authority rather than enlarging this
selection checkpoint.

## Lexical scenario verification

`verify-scenarios` is the private execution checkpoint for the accepted
selection. It is admitted only as this exact zero-argument workload command:

```bash
node scripts/safe-runner/cli.mjs run \
  --tier small \
  --workload real-repository-oracle-v1:scenario-verification \
  --report /absolute/non-repository/report.json \
  -- node benchmarks/real-repository-oracle-v1/workload.mjs verify-scenarios
```

The executor materializes a fresh reviewed checkout for each of the six ordered
scenarios; no checkout or scratch lease is reused. It verifies the selected
source blob and content before any mutation, parses exact NUL-terminated Git
porcelain-v2 state, and proves the complete stage-0 index and physical checkout
delta. Every scenario Git operation carries command-scoped
`core.symlinks=false`, matching materialization without persisting repository
config: reviewed mode-120000 links remain stage entries while their portable
link bodies remain physical regular files. Raw type-change porcelain is still
refused rather than relabeled as clean. Modify uses an append-only no-follow
descriptor with identity rechecks;
both mutation paths revalidate the named file and parent after opening and
immediately before mutation, so pathname substitution fails before any write or
unlink. Modify additionally reopens and verifies the exact appended bytes;
delete holds and verifies the opened inode through unlink, then proves the same
physical parent and its bounded exact directory-entry identity set minus only
the intended basename. Branch and linked
worktree refs use fixed full pins, no tracking, compare-and-delete cleanup, and
post-cleanup ref/config/reflog checks. Branch cleanup is not accepted until a
final read proves detached HEAD at the full pin, clean porcelain, and unchanged
stage-0 and physical checkout identities. The worktree case additionally binds the
selected logical worktree ID to the exact Git admin ID and proves the detached
primary and linked-branch topology without emitting physical scratch paths; its
reported topology digest is recomputed from that exact pin, logical ID, and
derived branch during decoding.

The result is one canonical raw-only base64url line smaller than 7,680 bytes,
including its prefix; it receives only the generic 8 KiB stdout/stderr tails.
The decoder accepts a schema-valid successful safe-runner report only when the
exact command, workload, source and execution identities, retry identity,
tier-promotion ladder, one-LF output, termination, and complete cleanup all
agree. Its explicit 8 KiB reservation is granted only to the exact audited
three-argument command paired with the exact scenario workload ID. The decoder
also recomputes the current checkout, runner build, entrypoint, and deterministic
source-closure receipt; self-consistent replacement hashes are insufficient.
The sealed source closure includes the reviewed scenario selection and
its narrow evidence-selection identity constants, but excludes discovery,
evidence expansion, fixtures, expectations, semantic adapters, graders, and
goldens.

The portable post-delete correction changes that sealed scenario source
closure. No earlier scenario report or promotion ladder qualifies these bytes.
A fresh #59 adversarial self-test and exact small-to-medium-to-large scenario
qualification ladder are required before treating the executor as requalified.

Every record binds its stage and physical before-count to the tier's reviewed
tracked-file count. All six fresh materializations must also agree on the exact
before stage and physical digests, preventing one scenario from silently using
a different base checkout. The generic temporary inode ceiling remains 8,192.
Only the exact large-tier scenario command and workload identity receive the
reviewed 16,384 ceiling, derived downward from the caller's temporary byte cap.
Its preflight receipt binds 5,405 tracked paths, 6,569 occupied destinations,
two simultaneous logical-worktree surfaces, a 1,024-inode control reserve, and
the execution-authority 16,384-file hard ceiling; crossed identities and other
tiers retain the generic cap.

This checkpoint is lexical Git-state evidence only. It carries the accepted
discovery digests as `selection_provenance_not_replayed`; it does not replay
discovery and makes no Workflow selection, observation, obligation,
localization, retrieval-ranking, grade, quality, or end-to-end runtime claim.
The command must not be executed from this source checkpoint. A real run remains
refused until a fresh adversarial self-test and exact small-to-medium-to-large
promotion ladder are completed from the reviewed commit.

## Workflow seed and private expectation candidate

`workflows-v1.json` is the only candidate-visible semantic seed. It contains
five bounded Workflows per tier and no request-to-answer, grading, mutation, or
held-out expectation material. The observation-category support receipt binds
exact production-extractor witnesses and distinguishes bounded negative
controls from complete-candidate-set absence; it does not turn absence into a
positive capability claim.

`reviews/case-expectations-v1.json` is private controller material. Its 72 cases
allocate exactly 24 rows per tier: 10 identity rows, 8 semantic/source rows,
and 6 accepted-state rows. The 31 registered mutations cover every mutation
kind in each tier plus the small bounded handler control. The authoring
projection reproduces the frozen JSON byte-for-byte, while the accepted
independent-review receipt separately seals collections, request/scenario pairs,
expectations/rationales,
mutations, gates, and the unchanged retrieval-v1 held-out identities (160
Workflow rows and 80 source rows). These are fixture-consistency and grader-
mechanics checks, not candidate measurements.

Every semantic row is also bound to an exact private mapping of same-tier
public-seed Workflow IDs and ordered public-seed surface IDs. Workflow-relevant
surfaces rank first; production observation-category exemplars do not become
source-localization goldens. A semantic contract category can be satisfied by
an exact Workflow relation such as actor authority, transition, entry surface,
or cross-Workflow dependency. A repository lexical category requires an exact
observed surface. The sealed row-to-category authority permits a cross-authority
second task only for small route/command, medium flag/route, and large
command/flag/event. Each such request ranks the Workflow surface first, names
the exact observed witness second, and says that the independent witness must
not be attached to the Workflow. Obligation expectations are exact structured
projections of the selected Workflow contract:
operation/target, transition, actor authority and Persona, failure contract,
resolved target/proof closure, and scenario proof. They are not seven labels
applied to an otherwise unexplained path.

The fixture loader clones private material at the controller boundary and does
not trust candidate-supplied fixtures or grades. Gradeable candidate closure is
not implemented or reachable. The bounded smoke below now proves one isolated
candidate execution path, but it deliberately receives no private expectations
and cannot issue a grade. Positive Persona capability therefore remains
excepted; quality pass is structurally unreachable until host-side grading and
the remaining candidate lifecycle are implemented and reviewed.

## Non-gradeable oracle-host cache-capability probe

The exact `probe-oracle-host` path now seals one content-addressed packed bare
Git cache per tier and proves read-only cache-capability transfer through it.
During execution-snapshot preparation the runner builds the exact single-pack bare
`cache.git` closure for the requested tier, seals pack and index bytes behind one
canonical manifest, and records the resulting authority in the oracle-host launch
profile. Oracle-host stages the sealed bytes only beneath the runner-owned
`payload-tmp` authority after proving that directory is canonical, mode `0700`,
same-user, and on tmpfs. It fsyncs the bytes, changes the file to mode `0400`,
reopens it read-only, and passes it to the attested bwrap keeper only as fixed
FD 4 with `--ro-bind-fd 4 /oracle-cache-capability`. No source pathname is
present in the bwrap argv and there is no pathname-bind or weaker fallback.

Bubblewrap 0.11.1 cannot ingest an already-unlinked regular-file descriptor, so
this checkpoint proves post-setup anonymization rather than pre-unlink anonymous
ingestion. The staging pathname exists transiently only during trusted bwrap
mount setup. After the exact bwrap info handshake confirms setup, oracle-host
unlinks the pathname, rechecks the open inode and bytes, and closes its source
descriptor before broker registration and before the blocked keeper can run.
The broker then independently opens `/oracle-cache-capability` through its
pinned keeper-root/proc anchor, matches device, inode, owner, mode, size, and
digest, checks the staging path is absent, and proves requester, outer bwrap,
and keeper retain no matching descriptor. It also requires a distinct
read-only mount, refuses writing through its read descriptor, and refuses a new
write open. This evidence is embedded in the existing quota proof.

Release closes the broker cache, state, and root descriptors before checking
for mount-ID pins. Finalization still requires keeper and outer bwrap death,
then releases the proc anchor; outer safe-runner cleanup remains mandatory. The
result remains `non_gradeable: true`, `cleanup_proof_issued: false`,
`grading_reachable: false`, and `candidate_executed: false`. It proves only this
sealed packed-bare-cache fixed-FD anonymous cache-capability transfer. It does
not materialize a repository lease, issue cleanup proof, execute a candidate, or
grade anything. A hostile same-UID concurrent process racing the transient
trusted setup pathname remains outside this probe's threat model.

## Non-gradeable Landlock candidate-launch probe

`npm run test:real-repository-oracle:landlock-candidate-probe` is a Linux-only
feasibility probe inside the existing generic safe-runner sandbox. The outer
sandbox remains responsible for the production systemd cgroup, user/PID/network
namespaces, bounded tmpfs, read-only execution snapshot, and masked control
sockets. Inside that context, a reviewed Linux v7.0 Landlock launcher handles
every live ABI right through ABI 8, refuses a newer ABI, sets no-new-privileges,
uses ABI 6 scopes and ABI 8 thread synchronization, and grants only exact
runtime/input/repository/output file descriptors before executing an adversarial
Node fixture. A reviewed x86-64 seccomp-BPF layer then denies persistent metadata
mutation, anonymous `memfd_create`, socket and socket-pair creation,
filesystem/topology construction, and named kernel/process/privilege-control
syscall classes with `EPERM`. Unsupported
architectures fail compilation and a kernel that cannot install the filter
refuses launch. This is defense-in-depth feasibility evidence, not a standalone
sandbox claim.

Authority remains deliberately split. The generic outer sandbox owns cgroup
limits, user/PID/network namespaces, the bounded tmpfs and read-only mount
snapshot, capability reduction, and control-socket masking. Landlock owns
pathname read/write/create/remove/execute rights, TCP rights, and ABI 6 scopes.
Seccomp closes Landlock ABI 8's persistent `chmod`/`chown`/timestamp/xattr gap,
including the x86-64 `setxattrat`, `removexattrat`, and `file_setattr` syscalls;
blocks anonymous executable files and high-risk topology/control syscalls; and
is inherited by the Node runtime. Fork and vfork return `EPERM`; clone3 returns
`ENOSYS` so pthread may fall back to legacy clone, whose BPF argument inspection
allows only `CLONE_THREAD`. Raw ioctl is denied except for the exact TCGETS,
TCGETS2, and FIONBIO requests Node v24 needs to inspect inherited stdio and make
pipe output nonblocking. A global ioctl denial was tested first and failed
before Node user code at stdout construction; valid-descriptor FIONREAD remains
an `EPERM` native denial self-test. `stat` remains read-only; `fcntl` and `flock`
remain available for Node's descriptor-local runtime behavior and do not grant
new pathname rights. The controller independently compares exact pre/post
repository dev, inode, mode, owner, group, mtime, ctime, directory-entry, and
file-content manifests. After candidate exit it also boundedly rescans the whole
private `/proc` namespace and accepts only the pre-recorded PID 1 and controller
identities. V8 executable memory and threads are required by Node and are not
claimed as denied executable-file or process paths.

The launcher is compiled from a digest-pinned source descriptor into an
anonymous `O_TMPFILE`, reopened as the same read-only inode, and executed through
its inherited `/proc/self/fd/N` descriptor after the writable descriptor is
closed. The probe records digest identities for the compiler and reported
cc1/as/ld/collect2 executables, but this is partial root-owned build evidence,
not a complete header or static-link input closure. It requires that host
toolchain and an exact Node runtime closure; no launcher binary or seccomp policy
artifact is packaged in native releases. A missing static compiler, unsupported
x86-64 inherited-FD execution, Landlock ABI below 3 or above 8, seccomp install
failure, or missing runtime dependency is a hard refusal rather than a weaker
fallback. The focused small-tier run uses a 32-task cgroup ceiling because the
measured outer Node/V8 threads and short-lived gcc/cc1/as/ld build tasks exceeded
16; its memory, time, output, and 64 MiB tmpfs bounds remain intentionally small.
The entrypoint, workload ID, launch profile, and all six bounds are exact shared
constants used by preflight, execution-snapshot, state, and tests. Any profile
mismatch is refused, retained structured stdout is bounded at 1 MiB for this
single profile, and both preflight and state authority independently reject
promotion even when a caller spoofs the workload ID.

The result always reports `non_gradeable: true`,
`cleanup_proof_issued: false`, `grading_reachable: false`, and
`candidate_executed: false`. It executes only the named adversarial probe and
does not make production candidate execution, host-side grading, cleanup-proof,
promotion, quality, or release-readiness reachable. The existing promotion
authority independently refuses this profile.

## Non-gradeable real-repository candidate smoke

`npm run test:real-repository-oracle:candidate-smoke` exercises exactly one
clean small-tier lease through the generic safe runner and production
persistent materializer. The exact envelope is 512 MiB hard memory, 384 MiB
memory high, 32 tasks, 180 seconds, 512 MiB temporary storage, and 256 KiB
combined output. The reviewed collection is fetched at its exact commit and
tree identity; one clean base is leased once and never replayed or promoted.

The controller keeps its plan, row mappings, and expectations private. During
materializer construction the payload invokes the required publication callback
twice and immediately returns exact acknowledgements inside that same payload.
Those are private intra-payload construction publications only: they are not a
supervisor-owned or durable recovery publication, do not satisfy an external
publication contract, and grant no cleanup authority. The candidate receives
only a canonical public batch and the candidate-visible checkout. Public request
nonces are derived from the domain, tier, slot, row, and request digest rather
than a private case identifier. The sealed deterministic adapter is benchmark
plumbing, not the future production candidate: it receives exact fixed
file-descriptor aliases for the adapter, input, repository, output, and scratch.
The launcher also pins
the exact Node executable, runtime-library closure, and configuration file while
constructing Landlock rules, but those descriptors do not survive into the
candidate process; Node's own descriptor closes on exec as well. Candidate argv
contains no controller paths. A dynamically allocated inherited descriptor at
or above 1025 is recorded in the exact FD 9 scratch file, and `close_range`
closes every descriptor from 10 through the kernel maximum before exec; the
adapter proves the recorded descriptor is `EBADF` while FD 9 still names the
exact scratch inode. Landlock plus seccomp prevent ungranted host or `/proc`
reads, repository mutation, extra processes, TCP/UDP, and control-socket
creation. The candidate inherits its working directory and may therefore see a
sealed-snapshot path string through `process.cwd()`. The claim is limited to no
controller paths in argv and no readable ungranted controller state, not absence
of every controller-derived path string. The threat model excludes a hostile
concurrent process already running under the same UID outside the runner's
private namespaces.

The adapter emits one bounded canonical raw artifact, which the existing
candidate contract parses and the controller compares with an independent
deterministic reconstruction. `verifyAndRelease` remains honest: cleanup is
false and the lease is quarantined under the runner-owned temporary authority.
The structural report validator revalidates the exact profile, source and
execution snapshot, termination, resource peaks, single complete output line,
and cleanup state; mutations are refused. It returns only the non-gradeable
record and cannot authenticate report provenance or cleanup. The dedicated host
controller constructs the command, workload, tier, and all six bounds itself,
calls the safe runner directly, validates that exact returned report, and then
issues a process-local, module-private `outer_cleanup_verified: true` object.
Caller environment, command, workload, override, and promotion authority are
rejected. A cloned or shape-identical object is not issued. The verification
still carries `cleanup_proof_issued: false` and `grading_reachable: false`.

Run the exact path manually only on a qualified Linux host:

```bash
npm run safe:envelope
npm run safe:self-test
npm run safe:run -- --tier small \
  --workload real-repository-oracle-v1:candidate-smoke-small \
  --report /absolute/path/to/candidate-smoke.json \
  --memory-mib 512 --memory-high-mib 384 --pids 32 \
  --timeout-ms 180000 --temporary-mib 512 --output-mib 0.25 \
  -- node benchmarks/real-repository-oracle-v1/workload.mjs smoke-candidate-small
```

The direct CLI command writes a raw safe-runner report; it neither invokes the
structural validator nor mints the controller's process-local verification. The
focused live test invokes the controller directly and verifies private-set
issuance.

This is first-phase execution evidence only. It does not expose private grader
authority, create supervisor-owned or durable materializer recovery publication,
create cleanup proof, run a second slot, replay a request, invoke an oracle host,
grade quality, or consume promotion authority.

## Evidence boundary

- Inventory admission proves only the exact pinned checkout equals the reviewed
  inventory.
- Case discovery proposes bounded authoring facts; it defines no golden answer.
- Evidence expansion proves only reviewed lexical Git facts and carries zero
  quality claims.
- Scenario verification proves only exact selected Git mutations and cleanup;
  it neither loads nor implies fixture, expectation, grader, or quality authority.
- The accepted independent-review receipt proves fixture consistency and
  mutation sensitivity only; it cannot issue or imply a candidate quality pass
  or runtime-readiness claim.
- A controller-issued candidate-smoke verification proves one bounded
  public-only execution and exact outer cleanup; it does not prove candidate
  quality, lease cleanup, or gradeability.
- A future semantic-core oracle may claim only the production seams it directly
  calls. Source localization remains `not_measured` unless actual post-scenario
  production retrieval is safely exercised.
- Public-CLI success requires separately attested end-to-end execution. Until
  that exists, it remains `safety_blocked` rather than inheriting a semantic-core
  pass.
