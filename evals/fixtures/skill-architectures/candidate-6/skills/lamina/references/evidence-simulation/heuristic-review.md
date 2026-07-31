# heuristic review

> Migrated intact from `skills/lamina-heuristic-review/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Expert Lens Review (agent-native)

Run **parallel skill-based reviewers** against contract and live product — not generic heuristic scores.

## Lenses (spawn in parallel)

| Lens | Checks |
|------|--------|
| Invariants | `lamina-invariants` vs workflows |
| Reachability | `lamina-dependencies` — unmet `dependencies[]` |
| Permissions | `actors` permissions, forbidden ops |
| Edge cases | `lamina-edge-cases` scenarios |
| A11y | verify a11y subagent on live UI |
| Consistency | `lamina-multi-view-integrity` |

Output: findings with contract ref and repro — not "severity 3 on heuristic 4".

## Anti-patterns

- **Nielsen theater** — 10 heuristics without domain context
- **Score without action** — ratings that don't map to `findings[]`

## Related

- Parallel Review
- Verify
