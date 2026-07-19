---
name: lamina-design
description: "Use only when explicitly invoked as lamina-design. Turn an incomplete product idea or brownfield change into a minimum sufficient product behavior graph: actors, entities, operations, workflows, rules, dependencies, decisions, persona perspectives, and distinct risks; then generate an implementation-ready contract."
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
9. `../lamina-orchestrator/audit-profiles.yaml`

Load two to four supporting skills selected from the risk signals in the design workflow. Do not preload every design skill, but do not omit a required trust, time, safety, accessibility, or multi-actor capability merely to keep the context small.

## Workflow

1. Require `.lamina/business-context.md` or emit `../lamina-orchestrator/prompts/outputs/init-blocked.md`.
2. Choose `spark`, `shape`, or `harden` from evidence and implementation risk. Use `harden` when a critical promise depends on authenticated authority, sensitive actor-scoped data, durable multi-actor truth, independent timing, destructive control, or safety-relevant behavior.
3. Create `run.json` immediately with the bundled graph tool.
4. Declare `proof_budget` before expanding the graph. Keep at most three critical promises, ten active operations, six active workflows, six active dependencies, six active surfaces, and twelve proofs; choose lower declared limits when the slice permits.
5. Capture the critical promises, actors, smallest coherent workflows, rules, dependencies, assumptions, and consequential decision forks within that budget. `harden` increases rigor at active boundaries, not product breadth.
6. Add only behavior that can be implemented and proved in the current iteration. Mark future behavior `deferred`; do not spend the active budget on an imagined production backlog.
7. Derive one scenario per distinct risk; deduplicate by `risk_key`.
8. Spawn up to three isolated, materially distinct persona perspective reviewers when the host supports subagents; otherwise run the same bounded reviews sequentially with separated context. Keep simulated preferences as `persona_hypothesis`.
9. Compile `proofs[]`: every critical promise, operation, workflow, invariant, dependency, and surface must be covered by a compact proof with authoritative-state, visible-outcome, recovery, boundary, and journey evidence. Include reload/restart, responsive, and accessibility evidence somewhere in the packet.
10. Resolve structural contradictions and blocking policy forks. Do not block on reversible defaults.
11. Validate, set `status: ready_to_build`, validate again, and render `run.md` plus `implement.md`.
12. Confirm all three files exist on disk before completing.

## Hard rules

- Be opinionated about structural coherence, safety, and integrity—not unsupported product policy.
- Trusted permissions and invariants must exist at the mutation boundary, not only in UI visibility.
- Complete cross-actor workflows through reachable enrollment or provisioning, recipient binding, durable state, both projections, expiry, and recovery. A core actor cannot require invisible out-of-band account creation.
- State relationships must declare lifecycle consequences.
- Shared consequential mutations require a concurrency strategy.
- Consequential identity requires proof of control; public identifiers alone are not authentication.
- Every critical promise must trace to critical graph nodes and at least one scenario.
- Map each evidence-backed persona to corresponding graph actors with `actor.persona_refs` when the relationship is known; otherwise keep the mapping explicit as unresolved instead of relying on matching names.
- Every critical actor declares its trusted authority and current-slice entry path; every critical entity declares stable identity, key field contracts, complete lifecycle outcomes, and lifecycle consequences; every critical operation declares preconditions, enforcement, failures, and recovery.
- Every critical dependency declares concrete fulfillment, owner, operational cadence/tolerance when relevant, unmet behavior, recovery, and observable verification.
- Operational actors must name a mechanism that runs independently of a participant's open browser when their promise depends on time or delivery.
- Consequential temporal fields declare whether they are instants, date-only values, local wall times plus IANA zone, durations, recurrences, or derived deadlines. Local wall times resolve at a trusted boundary with explicit DST gap/overlap recovery; recurring workflows define rollover and catch-up.
- A runnable local identity adapter still proves account control; typing a public identifier is not authentication. Cookie-authenticated mutations declare same-site and CSRF/origin protection. Production mode may fail closed when an external provider is absent, but the current slice must remain honestly usable.
- User-visible history and coordination promises expose who acted and when, not only internal audit fields.
- External delivery uses a runnable current-slice adapter, concrete provider seam and health/configuration contract, truthful delivery-attempt states, retry/rebinding behavior, and in-product truth that survives delivery failure.
- Critical UI surfaces must specify actor scope, reachable workflows and operations, journey continuity, and distinct loading, denial, stale, and recovery behavior.
- Acceptance scenarios are proof obligations: identify the authoritative post-action state, controlled clock or separate actor contexts when relevant, and avoid tests that can pass against stale pre-action content.
- Keep the ready contract under the validator's 48 KiB compact JSON ceiling. Compress wording and defer breadth; never weaken a critical trust boundary merely to fit.
- Every executable proof covers one reachable workflow and its active operations, points to its user-visible surfaces, and requires both trusted-boundary and journey-level evidence.
- The proof packet is the implementation plan. Do not add an unrelated architecture plan, production-readiness program, or speculative CRUD surface outside it.
- Do not create duplicate prose architecture outside `run.json`.

## Completion gate

Run:

```text
node <lamina-orchestrator-skill>/lib/graph-tool.mjs validate .lamina/runs/<run_id>/run.json
node <lamina-orchestrator-skill>/lib/graph-tool.mjs render .lamina/runs/<run_id>/run.json
test -f .lamina/runs/<run_id>/run.md && test -f .lamina/runs/<run_id>/implement.md
```

Do not claim completion while the graph is invalid, a blocking fork is unresolved, or generated artifacts are missing.
