---
id: decision-making
problems:
  - "feature prioritization debates"
  - "conflicting evidence from data sources"
  - "persona-based prioritization"
  - "conflicting data sources"
  - "analysis paralysis"
  - "feature prioritization debate"
  - "conflicting user needs"
related:
  - user-modeling
  - feature-prioritization
  - research-communication
---

# Decision Making

## When to load

- feature prioritization debates
- conflicting evidence from data sources
- persona-based prioritization
- conflicting data sources
- analysis paralysis
- feature prioritization debate
- conflicting user needs

## Heuristics

- **Decision filter**: Does this finding change a specific design or business decision? If not, dig deeper or stop.

## Evaluation rubrics

### Evidence Prioritization
- **When**: Multiple data sources suggest different actions.
- **Process**: Weight evidence by decision risk  ->  triangulate qual and quant  ->  prioritize actionable insights.
- **Pass**: Clear ranked recommendations with evidence cited.
- **Failure signals**: Analytics-only decisions; ignoring sample size limits.

### Primary User Filter
- **When**: Feature prioritization debates among multiple user types.
- **Process**: Ask: does this serve the primary user's goals ->  If no  ->  deprioritize or cut. If yes  ->  design fully for their scenario.
- **Pass**: Features ranked by primary user goal alignment.
- **Failure signals**: Designing for edge cases first; accommodating everyone equally  ->  nobody satisfied.

## Related capabilities

- [User Modeling](user-modeling.md)
- [Feature Prioritization](feature-prioritization.md)
- [Research Communication](research-communication.md)
