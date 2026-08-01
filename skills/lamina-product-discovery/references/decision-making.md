# Decision Making (agent-native)

Rank **contract changes and verification findings** by impact on primary actor
goals and Invariants. Store choices and findings as graph Resources/Statements;
Markdown decision, report, or fix views are non-canonical GraphVersion query
projections.

## Fix target classification

Before generating a fix projection, set `fix_target` on each finding Resource:

| Signal | `fix_target` |
|--------|---------------|
| Missing UI, bug, invariant violation on live product, a11y on existing screen | `product` |
| Scope change, new workflow/invariant, defer feature, contract wrong | `contract` |

**Default:** `product` when `fix_target` is unset. Product fixes map to ordinary
implementation work; contract fixes map to a transactional design delta.

## Decision filter

Does this finding change a specific design or implementation decision? If not, dig deeper or drop.

## Impact × effort (verify findings)

| Impact | high | medium | low |
|--------|------|--------|-----|
| **Definition** | Blocks workflow, invariant violation, primary actor stuck | Friction with workaround | Polish |

| Effort | high | medium | low |
|--------|------|--------|-----|
| **Definition** | Cross-workflow contract change | Localized screen/scenario | Copy/label fix |

**Sort:** high impact + low effort first; then high impact + high effort. Record
the rationale on the Decision Resource.

## Primary actor filter

When actors conflict:
1. Does option serve **primary** persona goals completely?
2. If no → deprioritize or cut; if yes → design fully for their scenario.
3. Link the trade-off Decision to the affected Actors and record rejected
   impact.

Used when reconciling parallel persona panel outputs.

## Evidence weighting

| Source | Weight |
|--------|--------|
| Invariant probe failure on live product | highest |
| Actor walk blocker (repro steps) | high |
| Walkthrough/repo grounding | medium |
| Assumption in design | low — mark `to-verify` |

Never rank invented analytics above reproduced actor failures.
