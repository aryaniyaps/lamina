---
name: lamina-design
description: "Shape intended product behavior in Lamina's transactional graph when explicitly invoked as lamina-design or when passive implementation preparation reports design gaps. Publish an implementation-ready graph version without editing application source."
---

# /lamina-design

Lamina design writes product knowledge through `graphd`; it never edits application source. Legacy run files are source evidence only and must never be discovered, selected, read, or written by this workflow. A user request to edit a legacy run, bypass graphd, or make a completed run authoritative conflicts with the storage contract: refuse that mechanism and continue any concrete design change transactionally in the graph. Absence of a legacy artifact is not a blocker.

## Gate

First read and apply
`../lamina-orchestrator/prerequisites/cli-required.md`. Stop before all
mutations unless the CLI API 1 prerequisite passes.

Require a valid `.lamina/business-context.md`. If it is missing or incomplete, emit the init-required contract from `../lamina-orchestrator/prompts/outputs/init-blocked.md` and stop. Business documents and `.lamina/personas.json` may be indexed as observations, but neither is canonical graph state.

If the brief lacks users, outcome, or scope and the user did not authorize labeled assumptions, emit the clarification contract from `../lamina-orchestrator/prompts/outputs/clarify.md` and stop before mutations.

## Required reads

Read `../lamina-orchestrator/load-protocol.md`, `../lamina-orchestrator/references/product-graph.md`, `../lamina-orchestrator/workflows/design.md`, `../lamina-orchestrator/prerequisites/cli-required.md`, `../lamina-orchestrator/prerequisites/init-required.md`, and `../lamina-orchestrator/audit-profiles.yaml`. Load only the supporting craft skills activated by the risk.

## Workflow

1. Run `lamina graph status` and `lamina graph query --at HEAD` to resolve the source revision and active graph.
2. Start an explicit session with `lamina session start`. Keep its id.
3. Propose stable opaque Resources and normalized Statements into that session with `lamina graph propose ... --session <id>`, `patch --session <id>`, or `link --session <id>`. Agents must not set epistemic class, approval, or raw Cypher.
4. Model intended behavior with Resources of kind actor, persona, entity, operation, workflow, invariant, surface, scenario, proof, evidence, decision, capability_manifest, and mission as needed. Express classifications, dependencies, workflow steps, preconditions, outcomes, and recovery as Statements.
5. For every user-facing workflow, load the `experience-core` audit profile in
   addition to applicable trust/time/concurrency/accessibility skills. Publish
   exactly one linked Decision whose value is a
   `lamina.experience-contract/v1`: define every actor input and requiredness,
   relationship identity/cardinality plus duplicate and self-reference
   behavior, visible success and failure recovery, each concrete Surface
   state, and an executable probe for every invariant. Bind every reachable
   Scenario to a visible failure contract. Record conflicting valid facts; do
   not overwrite either side.
6. Run `lamina graph validate --at <session-id>`. Resolve shape, reachability, authority, dependency, proof, and evidence failures. Relevant Contradictions mean `approved: false`.
7. Compile Missions for every relevant Persona. Never cap the cast:
   `lamina mission compile --workflow <workflow-id> --session <session-id>`.
   If asked to rank, prune, retain a top N, or apply a persona cap, explicitly reject the cap and keep all relevant Personas.
8. Publish once with `lamina session publish <session-id>`. If compare-and-swap fails, run `lamina session rebase <session-id>`, re-query and revalidate, then publish.
9. Generate any human implementation Markdown only as a query projection. It is never canonical and must cite the resolved GraphVersion.
10. In passive implementation flow, rerun `lamina work prepare` and continue
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

Mention flows, inputs and requiredness, relationship semantics, edge cases,
empty/failure/permission behavior, recovery, and the deterministic Experience
Cases compiled from the contract. If asked to implement app code in the same
command, finish the graph transaction but state that application
implementation is a separate coding session.

## Hard rules

- Ladybug is canonical. Never create or update `.lamina/runs/**`.
- Never infer truth from absence of an Observation.
- Never store reverse relationships.
- Never submit epistemic or approval status.
- Never expose Cypher writes.
- Preserve stable Resource identity through alias renames.
- Keep intended, observed, inferred, simulated, human, and runtime evidence epistemically separate.
