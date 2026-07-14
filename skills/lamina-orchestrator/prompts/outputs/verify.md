### Executive summary
What was verified (live `base_url` and/or static source) and overall result.

### Contract checked
Design run id, dependencies, invariants, and scenario acceptances tested.

### Grounding mode
`live_app` | `static_source` | `mixed` — never blocked solely for missing `base_url`.

### Actor walk results
Per-actor allowed/forbidden operations.

### Reachability results
Per `domain.dependencies[]` edge — mode honored (unreachable / degraded / blocked_ui / recover); linked scenario acceptance pass/fail.

### Invariant and scenario results
Passes and failures against `scenarios[]` / `acceptance`.

### Accessibility
Findings from captured steps or source hooks.

### Findings
Machine-readable: `run.yaml` `findings[]` with `fix_target: product | contract | ops`.

### Ops notes (optional)
CI/deploy/push/monitoring mentions — not product ship gates unless the brief requires them. Do not put these in `fix.md` Product fixes.

### Gaps
What to fix in product or design contract.

### Open questions

### Next steps

1. Implement product fixes from `.lamina/runs/<run_id>/fix.md` end to end in a coding session (app source allowed; do not modify `.lamina/`). `fix.md` is always written.
2. Re-run `/lamina-verify` after fixes are deployed.
3. For contract deltas listed in `fix.md`, run `/lamina-design` with the scoped prompt — do not implement those in app code without a design pass.
