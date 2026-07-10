# LaminaBench Human Review Rubric

Score each criterion **1–5** (1 = poor, 5 = excellent). Raters are blind to whether an implementation is Control or Treatment.

You are reviewing **implemented product source**, not `.lamina/` artifacts or plan markdown.

- **Control (A/B)**: code after Plan mode → implement (no verify/fix loop)
- **Treatment**: code after the full Lamina loop (post-fix)

## Criteria

1. **Domain / system structure** — Entities and relationships expressed in code (types, models, modules); not a UI shell without domain logic
2. **Invariants and product rules** — Illegal states prevented or rejected in code; guards, validation, or state machines — not comments alone
3. **Actors and permissions** — Role checks, authorization boundaries, or data scoping visible in implementation
4. **Workflow quality** — A primary journey implemented end-to-end with coherent state transitions
5. **Scenario / edge coverage** — Failure, recovery, or edge paths handled (errors, retries, empty states, idempotency where relevant)
6. **Systems judgment** — Structure reflects sensible trade-offs; avoids obvious product traps (e.g. silent data loss, permission leaks)
7. **UX expression under rules** — UI or API surfaces reflect domain rules (errors, empty states, a11y hooks where present)
8. **Brownfield fit** — Integrates sensibly with existing fixture code (N/A for greenfield → score internal consistency)
9. **Implementation readiness** — Product implementation is coherent and buildable; clear entry points; not a stub-only scaffold
10. **Overall product-behavior quality** — Holistic judgment of product behavior **as expressed in code**

## Scoring guide

| Score | Meaning |
|-------|---------|
| 1 | Missing or fundamentally wrong |
| 2 | Superficial; major gaps in domain rules or scenarios |
| 3 | Adequate; notable omissions in invariants or edge handling |
| 4 | Strong; minor gaps only |
| 5 | Excellent; production-quality reasoning visible in code |

## Instructions

- Read the task description before scoring each implementation
- Score **code behavior and structure**, not document formatting
- Penalize shallow UI without domain rules **and** missing invariant enforcement or recovery paths
- Do **not** reward invented interviews, fake analytics, or workshop theater (in comments or docs)
- Do **not** reward Lamina-specific file layout — score product-behavior substance in source
- Record brief notes for scores ≤ 2 or ≥ 4
