# Persona perspective review

Use personas as bounded perspective auditors, never as evidence of user preference.

## Selection

Choose no more than three actors with materially different goals, authority, vulnerability, or operating context. Skip duplicate perspectives.

## Isolated prompt

Give each reviewer only:

- One entry from `.lamina/personas.json`.
- Relevant critical promises.
- The actor's graph slice.
- The workflow or verification evidence being walked.

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
