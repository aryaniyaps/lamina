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
digests for tracked paths and occupied destinations. Generated and build outputs,
including hashed Workbox bundles, are excluded explicitly. The complete index
is encoded with the versioned `LDO1` transport: a deterministic UTF-8 string
table and typed tuples are Brotli-compressed into one bounded report-tail line.
The decoder reconstructs the exact logical discovery object for reviewer use;
the transport drops no candidate fields. Non-canonical, malformed, tampered,
or oversized transports are refused rather than lossily compacted.

Discovery output has zero quality claims, cannot load the grader or expectation
contract, and cannot be used directly by `validate`. Its handoff requires an
independent human review before any later fixture or expectation is authored.

## Reviewer-selected evidence expansion

`reviews/evidence-selection-v1.json` is a committed, digest-bound, tier-keyed
selection authority. It is currently marked pending authoring and is explicitly
not grade or expectation authority. After independent reviewers populate its
bounded anchors, expansion uses an exact zero-argument workload command:

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
