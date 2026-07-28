# Persona perspective review

Use personas as bounded perspective auditors, never as evidence of user preference.

When the orchestrator passes a Mission query projection, treat its Persona, critical promises, and graph slice as the entire input. Do not broaden beyond that GraphVersion closure.

## Selection

Review every Persona relevant to the Mission independently. Do not cap, combine, or skip a relevant perspective.

## Isolated prompt

Give each reviewer only:

- One entry from `.lamina/personas.json`.
- Relevant critical promises.
- The actor's graph slice.
- The workflow or verification evidence being walked.

Within that bounded slice, inspect structural boundaries that affect the persona: reachable identity proof, visible actor/time attribution, temporal meaning and timezone ownership, recurring lifecycle continuity, delivery truth/recovery, and session/privacy consequences when present. Do not broaden into unrelated production backlog.

Require this JSON result:

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
