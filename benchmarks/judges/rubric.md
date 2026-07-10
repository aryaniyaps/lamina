# LaminaBench Human Review Rubric

Score each criterion **1–5** (1 = poor, 5 = excellent). Raters are blind to whether an artifact is Control or Treatment.

## Criteria

1. **Domain / system structure** — Entities, relationships, and purpose defined; not a screen list
2. **Invariants and product rules** — Illegal states named; rules before UI; testable constraints
3. **Actors and permissions** — Who can do what; multi-view integrity across roles
4. **Workflow quality** — Logical journeys over state and operations with clear decision points
5. **Scenario / edge coverage** — Violation attempts, recovery paths, concurrency/idempotency where relevant
6. **Systems judgment** — Trade-offs named; leverage on rules and information before UI churn; structural traps avoided
7. **UX expression under rules** — Surfaces reflect domain truth (empty/error/a11y as expression, not the whole score)
8. **Brownfield fit** — Integration with existing product (N/A for greenfield → score internal consistency)
9. **Implementation readiness** — Actionable implement-brief quality for a coding agent to build from
10. **Overall product-behavior quality** — Holistic judgment of end-to-end product reasoning

## Scoring guide

| Score | Meaning |
|-------|---------|
| 1 | Missing or fundamentally wrong |
| 2 | Superficial; major gaps in domain rules or scenarios |
| 3 | Adequate; notable omissions in invariants or trade-offs |
| 4 | Strong; minor gaps only |
| 5 | Excellent; production-ready product-behavior reasoning |

## Instructions

- Read the task description before scoring each artifact
- Do not reward formatting alone — evaluate reasoning depth
- Penalize shallow UX checklists **and** missing invariants, scenarios, or trade-offs
- Do **not** reward invented interviews, fake analytics, SUS scores, or workshop theater
- Do **not** reward Lamina-specific section titles or `.lamina/` file structure — score product-behavior substance
- Record brief notes for scores ≤ 2 or ≥ 4
