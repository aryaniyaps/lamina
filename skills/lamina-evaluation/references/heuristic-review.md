# Expert Lens Review (agent-native)

Run **parallel skill-based reviewers** against contract and live product — not generic heuristic scores.

## Lenses (spawn in parallel)

| Lens | Checks |
|------|--------|
| Invariants | `lamina-product-behavior/references/invariants.md` vs workflows |
| Reachability | `lamina-product-behavior/references/dependencies.md` — unmet prerequisite Statements |
| Permissions | `actors` permissions, forbidden ops |
| Edge cases | `lamina-ux/references/edge-cases.md` — distinct-risk Scenario Resources |
| A11y | verify a11y subagent on live UI |
| Consistency | `lamina-product-behavior/references/multi-view-integrity.md` |

Output: proposed finding Resources/Statements with contract ref and repro — not
"severity 3 on heuristic 4". Runtime findings become evidence only through a
published Mission Run.

## Anti-patterns

- **Nielsen theater** — 10 heuristics without domain context
- **Score without action** — ratings that do not map to a proposed finding and
  an observable remediation target
