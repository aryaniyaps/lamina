# Persona perspective review

Use personas as bounded perspective auditors, never as evidence of user preference.

When the orchestrator passes a `lamina.persona-walk-task/v1`, this is a
design-time simulation before implementation. Treat its single Persona,
proposed Workflow coverage, and required state/edge axes as the entire input.
Walk every operation node, including denied and inapplicable nodes. Return
missing Operations, branches, permissions, states, Scenarios, Invariants,
Surfaces, recovery paths, and transitions so the parent can expand the graph.
Do not inspect or assume implementation source.

When the orchestrator passes a Mission query projection, this is post-build
runtime verification. Treat its Persona, critical promises, and graph slice as
the entire input. Do not broaden beyond that GraphVersion closure.

## Selection

Review every Persona relevant to the Mission independently. Do not cap, combine, or skip a relevant perspective.

## Isolated prompt

Give each reviewer only:

- One entry from `.lamina/personas.json`.
- Relevant critical promises.
- The actor's graph slice.
- The workflow or verification evidence being walked.

Within that bounded slice, inspect structural boundaries that affect the persona: reachable identity proof, visible actor/time attribution, temporal meaning and timezone ownership, recurring lifecycle continuity, delivery truth/recovery, and session/privacy consequences when present. Do not broaden into unrelated production backlog.

For a design task, require a `lamina.persona-walk/v1` JSON result
bound to its `task_id`, `workflow_ref`, and `persona_ref`, with mode,
isolation_ref, goal, one node analysis per proposed operation, and explicit
discovery arrays for Personas, Actors, Operations, Scenarios, Invariants,
Surfaces, branches, and open decisions. Return every array even when empty.

For a Mission perspective review, require this JSON result:

```json
{
  "persona_ref": "persona.<id>",
  "outcome": "success | partial | blocked",
  "findings": [
    {
      "id": "<stable-id>",
      "classification": "structural_defect | contradiction | missing_recovery | reversible_ux | policy_fork | research_hypothesis",
      "finding": "<observed problem>",
      "graph_refs": ["workflow.<id>"],
      "severity": "high | medium | low",
      "source": "persona_hypothesis"
    }
  ]
}
```

Do not ask reviewers to prescribe implementation. Merge structural defects, contradictions, and missing recovery into the graph. Keep reversible UX and policy suggestions explicit. Never convert research hypotheses into requirements without user or research evidence.
