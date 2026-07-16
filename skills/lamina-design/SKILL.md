---
name: lamina-design
description: "Turn an incomplete product idea or brownfield change into a minimum sufficient product behavior graph: actors, entities, operations, workflows, rules, dependencies, decisions, persona perspectives, and distinct risks; then generate an implementation-ready contract."
disable-model-invocation: true
---

# /lamina-design

Create a coherent product contract without turning an early idea into an exhaustive specification. Write `.lamina/` only; defer application source to the implementation turn.

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor application source.

## Required reads

Read these files before writing:

1. `../lamina-orchestrator/load-protocol.md`
2. `../lamina-orchestrator/artifacts.md`
3. `../lamina-orchestrator/references/product-graph.md`
4. `../lamina-orchestrator/workflows/design.md`
5. `../lamina-orchestrator/patterns/persona-panel.md`
6. `../lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
7. `../lamina-orchestrator/prerequisites/init-required.md`
8. `../lamina-orchestrator/prompts/outputs/init-blocked.md`

Load one or two supporting skills only when the product needs them. Do not preload every design skill.

## Workflow

1. Require `.lamina/business-context.md` or emit `../lamina-orchestrator/prompts/outputs/init-blocked.md`.
2. Choose `spark`, `shape`, or `harden` from evidence and implementation risk.
3. Create `run.json` immediately with the bundled graph tool.
4. Capture the critical promise, actors, smallest coherent workflow, rules, dependencies, assumptions, and consequential decision forks.
5. Add only behavior relevant to the current iteration. Mark future behavior `deferred`.
6. Derive one scenario per distinct risk; deduplicate by `risk_key`.
7. Spawn up to three isolated, materially distinct persona perspective reviewers when the host supports subagents; otherwise run the same bounded reviews sequentially with separated context. Keep simulated preferences as `persona_hypothesis`.
8. Resolve structural contradictions and blocking policy forks. Do not block on reversible defaults.
9. Validate, set `status: ready_to_build`, validate again, and render `run.md` plus `implement.md`.
10. Confirm all three files exist on disk before completing.

## Hard rules

- Be opinionated about structural coherence, safety, and integrity—not unsupported product policy.
- Trusted permissions and invariants must exist at the mutation boundary, not only in UI visibility.
- Complete cross-actor workflows through recipient binding, durable state, both projections, expiry, and recovery.
- State relationships must declare lifecycle consequences.
- Shared consequential mutations require a concurrency strategy.
- Consequential identity requires proof of control; public identifiers alone are not authentication.
- Every critical promise must trace to critical graph nodes and at least one scenario.
- Do not create duplicate prose architecture outside `run.json`.

## Completion gate

Run:

```text
node <lamina-orchestrator-skill>/lib/graph-tool.mjs validate .lamina/runs/<run_id>/run.json
node <lamina-orchestrator-skill>/lib/graph-tool.mjs render .lamina/runs/<run_id>/run.json
test -f .lamina/runs/<run_id>/run.md && test -f .lamina/runs/<run_id>/implement.md
```

Do not claim completion while the graph is invalid, a blocking fork is unresolved, or generated artifacts are missing.
