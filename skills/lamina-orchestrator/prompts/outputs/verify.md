### Executive summary
What was verified and overall result.

### Contract checked
Design run id, dependencies, and invariants tested.

### Actor walk results
Per-actor allowed/forbidden operations.

### Reachability results
Per `domain.dependencies[]` edge — unmet prerequisite blocked or recovered on live product.

### Invariant and scenario results
Passes and failures against `scenarios[]`.

### Accessibility
Findings from captured steps.

### Findings
Machine-readable: `run.yaml` `findings[]`.

### Gaps
What to fix in product or design contract.

### Open questions

### Next steps

1. Implement product fixes from `.lamina/runs/<run_id>/fix.md` in a coding session (app source allowed; do not modify `.lamina/`).
2. Re-run `/lamina-verify` after fixes are deployed.
3. For contract deltas listed in `fix.md`, run `/lamina-design` with the scoped prompt — do not implement those in app code without a design pass.
