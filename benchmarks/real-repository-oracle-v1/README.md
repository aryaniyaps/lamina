# Real-repository oracle v1

This benchmark separates repository admission, case discovery, expectation
review, semantic-core grading, and public-CLI qualification. Evidence from an
earlier stage cannot be relabeled as evidence from a later one.

The three repository pins and their inventories are manually reviewed. The
current quality fixture is not: real path, blob, symbol, Workflow, and expected
outcome facts still require independent review. Consequently `validate` stays
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

## Evidence boundary

- Inventory admission proves only the exact pinned checkout equals the reviewed
  inventory.
- Case discovery proposes bounded authoring facts; it defines no golden answer.
- Evidence expansion proves only reviewed lexical Git facts and carries zero
  quality claims.
- A future semantic-core oracle may claim only the production seams it directly
  calls. Source localization remains `not_measured` unless actual post-scenario
  production retrieval is safely exercised.
- Public-CLI success requires separately attested end-to-end execution. Until
  that exists, it remains `safety_blocked` rather than inheriting a semantic-core
  pass.
