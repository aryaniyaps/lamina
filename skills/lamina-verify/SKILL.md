---
name: lamina-verify
description: "Use only when explicitly invoked as lamina-verify. Verify a live or brownfield product against its product graph: critical promises, reachable workflows, authority, invariants, state integrity, recovery, accessibility, and contract drift; emit evidence-backed fixes before merge."
---

# /lamina-verify

Treat application source as read-only evidence. Write findings and reports only under `.lamina/`; a later fix turn edits application source.

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor application source.

## Required reads

1. `../lamina-orchestrator/load-protocol.md`
2. `../lamina-orchestrator/artifacts.md`
3. `../lamina-orchestrator/references/product-graph.md`
4. `../lamina-orchestrator/workflows/verify.md`
5. `../lamina-orchestrator/patterns/persona-panel.md`
6. `../lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
7. `../lamina-orchestrator/prerequisites/init-required.md`
8. `../lamina-orchestrator/prompts/outputs/init-blocked.md`

Load accessibility, dependency, identity, or other supporting skills only when the graph or evidence requires them.

## Verification order

1. Load `run.json`, set `status: verifying`, and identify critical promises.
2. Use a live walkthrough when available; otherwise trace reachable application source and run non-mutating builds/tests.
3. Inventory every critical workflow operation and its trusted enforcement, state mutation, persistence, actor-scoped projection, visible outcome, attribution, and recovery.
4. Load `proofs[]` and `product-proof-manifest.json`. Confirm every proof maps to existing automated checks containing `[proof:<id>]`, and run the complete declared suite at least three times. Missing finite per-test timeouts, resources not released from failure-safe `finally` blocks, open-handle exit delays, skips, nondeterministic exits, unmapped behavior, prose-only checks, or failures are product findings.
5. Probe denial, unmet dependency, invalid transition, concurrency, destructive recovery, stale-state behavior, session-mutation protection, and identity proof relevant to the graph. When time is consequential, verify the temporal kind, browser-zone/subject-zone boundary, DST gap/overlap behavior, recurrence rollover, controlled authoritative clock, and delayed/duplicate runner behavior. When delivery is consequential, verify the provider seam, truthful attempt state, retry/rebinding, and independence of in-product truth.
6. Spawn only materially distinct, isolated persona perspective reviewers grounded in product evidence; use sequential separated-context reviews only when subagents are unavailable.
7. Compare implementation to graph and record both product defects and contract drift.
8. Write ticket-shaped `findings[]`, `report.md`, and `fix.md`, keyed to proof ids where applicable.
9. Set `status: complete`, validate the graph, and confirm both Markdown files exist.

## Evidence rules

- Tests, types, comments, scenario names, and seed data are not sufficient proof that production paths work.
- Broken imports, placeholder handlers, client-only privacy, privileged default identity, unpersisted mutations, and unreachable flows are product findings.
- Browser parsing of subject-local wall time, self-asserted public identifiers as authentication, cookie mutations without a declared CSRF/origin posture, false notification success, and disappearing recurring work are product findings when those boundaries are active.
- Every non-ops finding needs source or walkthrough evidence and observable acceptance criteria.
- Empty findings are valid only when every critical promise and workflow has independent evidence.
- Simulated persona preference remains a hypothesis; structural and accessibility failures may become findings.

## Completion gate

```text
node <lamina-orchestrator-skill>/lib/graph-tool.mjs validate .lamina/runs/<run_id>/run.json
test -f .lamina/runs/<run_id>/report.md && test -f .lamina/runs/<run_id>/fix.md
```
