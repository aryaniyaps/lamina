---
name: lamina-verify
description: "Verify a live or brownfield product against its product graph: critical promises, reachable workflows, authority, invariants, state integrity, recovery, accessibility, and contract drift; emit evidence-backed fixes before merge."
disable-model-invocation: true
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
3. Inventory every critical workflow operation and its trusted enforcement, state mutation, persistence, actor-scoped projection, visible outcome, and recovery.
4. Probe denial, unmet dependency, invalid transition, concurrency, destructive recovery, and stale-state behavior relevant to the graph.
5. Spawn only materially distinct, isolated persona perspective reviewers grounded in product evidence; use sequential separated-context reviews only when subagents are unavailable.
6. Compare implementation to graph and record both product defects and contract drift.
7. Write ticket-shaped `findings[]`, `report.md`, and `fix.md`.
8. Set `status: complete`, validate the graph, and confirm both Markdown files exist.

## Evidence rules

- Tests, types, comments, scenario names, and seed data are not sufficient proof that production paths work.
- Broken imports, placeholder handlers, client-only privacy, privileged default identity, unpersisted mutations, and unreachable flows are product findings.
- Every non-ops finding needs source or walkthrough evidence and observable acceptance criteria.
- Empty findings are valid only when every critical promise and workflow has independent evidence.
- Simulated persona preference remains a hypothesis; structural and accessibility failures may become findings.

## Completion gate

```text
node <lamina-orchestrator-skill>/lib/graph-tool.mjs validate .lamina/runs/<run_id>/run.json
test -f .lamina/runs/<run_id>/report.md && test -f .lamina/runs/<run_id>/fix.md
```
