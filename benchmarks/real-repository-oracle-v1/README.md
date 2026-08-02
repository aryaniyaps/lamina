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

`discover-cases` is the only case-authoring entrypoint. It must run through the
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
candidate set. Generic definition names and short contexts are discovery-only
authoring aids. The complete retained result is Brotli-compressed into one bounded
report-tail line; stdout truncation is never accepted as evidence.

Discovery output has zero quality claims, cannot load the grader or expectation
contract, and cannot be used directly by `validate`. Its handoff requires an
independent human review receipt binding Git blobs and symbols, full per-pin
coverage, expectation-private evaluation, and production-seam provenance.

## Evidence boundary

- Inventory admission proves only the exact pinned checkout equals the reviewed
  inventory.
- Case discovery proposes bounded authoring facts; it defines no golden answer.
- A future semantic-core oracle may claim only the production seams it directly
  calls. Source localization remains `not_measured` unless actual post-scenario
  production retrieval is safely exercised.
- Public-CLI success requires separately attested end-to-end execution. Until
  that exists, it remains `safety_blocked` rather than inheriting a semantic-core
  pass.
