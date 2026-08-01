---
name: lamina-design
description: "Shape intended product behavior in Lamina's transactional graph when explicitly invoked as lamina-design or when passive implementation preparation reports design gaps. Publish an implementation-ready graph version without editing application source."
---

# /lamina-design

Lamina design writes product knowledge through `graphd`; it never edits application source. Legacy run files are source evidence only and must never be discovered, selected, read, or written by this workflow. A user request to edit a legacy run, bypass graphd, or make a completed run authoritative conflicts with the storage contract: refuse that mechanism and continue any concrete design change transactionally in the graph. Absence of a legacy artifact is not a blocker.

## Gate

First read and apply
`../lamina/orchestrator/prerequisites/cli-required.md`. Stop before all
mutations unless the CLI API 1 prerequisite passes.

Require a valid `.lamina/business-context.md`. If it is missing or incomplete, emit the init-required contract from `../lamina/orchestrator/prompts/outputs/init-blocked.md` and stop. Business documents and `.lamina/personas.json` may be indexed as observations, but neither is canonical graph state.

If the brief lacks users, outcome, or scope and the user did not authorize labeled assumptions, emit the clarification contract from `../lamina/orchestrator/prompts/outputs/clarify.md` and stop before mutations.

## Required reads

Read `../lamina/orchestrator/load-protocol.md`, `../lamina/orchestrator/references/product-graph.md`, `../lamina/orchestrator/workflows/design.md`, `../lamina/orchestrator/prerequisites/cli-required.md`, `../lamina/orchestrator/prerequisites/init-required.md`, and `../lamina/orchestrator/audit-profiles.yaml`. Load `experience-core.always`, then only the `experience-core.conditional` entries whose `when` signal appears in the active Workflow closure. For each entry, open the named capability `SKILL.md` and then its exact reference; do not load sibling topics.

## Workflow

1. Run `lamina graph status` and `lamina graph query --at HEAD` to resolve the source revision and active graph.
2. For a brand-new feature, first publish only the minimum graph skeleton
   needed to walk it: Workflow, full active Persona roster, assumed Actors, and
   the currently proposed ordered Operations. This seed is not an
   implementation-ready contract and does not require source files.
3. For each active Persona run `lamina design prepare-walk --workflow
   <workflow> --persona <persona> --request-file <request> --output
   <task.json>`. Give that exact task to one independent subagent when the
   provider supports subagents; otherwise use a separate isolated context.
   Walkers receive no other Persona's conclusions.
4. Each Persona walker must traverse every proposed operation node, including
   nodes the Persona is denied from or for which the node is inapplicable.
   At each node independently decide intent, assumed Actor, authorization and
   conditions, actor inputs and requiredness, relationship identity/cardinality,
   duplicate and self-reference behavior, the canonical state matrix plus
   every product-specific Operation or Surface state, every declared Scenario,
   every Invariant probe, success/failure/denial transitions, and the
   validation, authorization, duplicate, self-reference, concurrency,
   stale-data, interruption, retry, and connectivity edge axes. It must return
   explicit discovery arrays for Personas, Actors, Operations, Scenarios,
   Invariants, Surfaces, branches, and open decisions, not mutate the graph.
5. Record each result with `lamina design record-walk --task <task.json>
   --result <result.json>`. The result must be
   `lamina.persona-walk/v1`, name its isolation context, and remain
   source-read-only. `graphd` publishes it as engine-owned simulated evidence.
6. The parent agent unions all Persona findings. Expand the graph so every
   discovered operation, branch, permission, state, Scenario, Invariant,
   Surface, recovery, and transition is canonical before implementation.
   Preserve disagreements as Contradictions instead of collapsing them.
7. Expansion changes the coverage digest. After publishing discoveries, rerun
   steps 3-6 for every Persona until one complete round discovers no new
   discovery in any category. Stale walks and non-empty discovery matrices
   cannot satisfy readiness.
8. Start the final explicit design session with `lamina session start`. Propose
   stable opaque Resources and normalized Statements with `lamina graph propose
   ... --session <id>`, `patch --session <id>`, or `link --session <id>`.
   Agents must not set epistemic class, approval, or raw Cypher.
9. Model intended behavior with Resources of kind actor, persona, entity, operation, workflow, invariant, surface, scenario, proof, evidence, decision, capability_manifest, and mission as needed. Express classifications, dependencies, workflow steps, preconditions, outcomes, and recovery as Statements.
10. For every workflow, apply the already selected `experience-core` entries.
   Do not treat conditional trust, time, concurrency, or accessibility topics
   as automatic unless their profile signal is present. Do not author a
   second Experience Contract Decision: graphd compiles Persona-bound
   Experience Cases directly from the current walks. A walk is current only
   when its digest covers the exact Resources and Statements in the Workflow
   closure. Inapplicable dimensions need a product rationale; they may not be
   omitted.
11. Run `lamina graph validate --at <session-id>`. Resolve shape, reachability, authority, dependency, proof, Persona-walk, and evidence failures. Relevant Contradictions mean `approved: false`.
12. Compile Missions for every active Persona. Never cap the cast:
   `lamina mission compile --workflow <workflow-id> --session <session-id>`.
   If asked to rank, prune, retain a top N, or apply a persona cap, explicitly reject the cap and keep all active Personas.
13. Publish once with `lamina session publish <session-id>`. If compare-and-swap fails, run `lamina session rebase <session-id>`, re-query and revalidate, then publish.
14. Generate any human implementation Markdown only as a query projection. It is never canonical and must cite the resolved GraphVersion.
15. In passive implementation flow, rerun `lamina work prepare` and continue
    only when it returns an implementation-ready packet. Do not tell the user
    to invoke this skill.

Single mutations may use implicit one-shot sessions through `lamina graph propose`, `patch`, or `link`. A multi-fact design must use one explicit session so it commits completely or leaves the branch unchanged.

## Output

Report the resolved GraphVersion and source revision, then:

```markdown
### Domain and invariants
### Actors and permissions
### Workflows
### Scenarios
### Implementation projection
### Contradictions and open questions
```

Report each Persona walk separately before the union: nodes traversed,
permission decisions, discovered branches, states, edge axes, Scenarios,
Invariants, and unresolved conflicts. Then report the expanded canonical
graph and Persona-bound deterministic Experience Cases. If asked to implement
app code in the same ordinary request, continue through WorkMap and
implementation after the graph transaction; only an explicit graph-only
`/lamina-design` invocation ends before source edits.

## Hard rules

- Ladybug is canonical. Never create or update `.lamina/runs/**`.
- Never infer truth from absence of an Observation.
- Never store reverse relationships.
- Never submit epistemic or approval status.
- Never expose Cypher writes.
- Preserve stable Resource identity through alias renames.
- Keep intended, observed, inferred, simulated, human, and runtime evidence epistemically separate.
