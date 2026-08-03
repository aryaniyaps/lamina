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
not trust candidate-supplied fixtures or grades. Candidate closure is not
implemented or reachable. In particular, positive Persona capability remains
excepted until a later candidate-facing sealed probe exists; quality pass is
structurally unreachable until that probe, candidate isolation, and host-side
grading are implemented and reviewed.

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
- A future semantic-core oracle may claim only the production seams it directly
  calls. Source localization remains `not_measured` unless actual post-scenario
  production retrieval is safely exercised.
- Public-CLI success requires separately attested end-to-end execution. Until
  that exists, it remains `safety_blocked` rather than inheriting a semantic-core
  pass.
