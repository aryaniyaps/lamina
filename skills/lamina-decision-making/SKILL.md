---
name: lamina-decision-making
description: "Decision Making UX guidance. Use when feature prioritization debates; conflicting evidence from data sources; persona-based prioritization."
metadata:
  lamina:
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
      - lamina-user-modeling
      - lamina-feature-prioritization
      - lamina-research-communication
---
# Decision Making

## Heuristics

- **Decision filter**: Does this finding change a specific design or business decision? If not, dig deeper or stop.

## Impact × effort scoring

Use when prioritizing findings (especially `/lamina-audit`):

| Dimension | high | medium | low |
|---|---|---|---|
| **Impact** | Blocks task completion, major trust/a11y risk, or primary-user goal failure | Significant friction; workaround exists | Polish or minor clarity |
| **Effort** | Cross-flow redesign, new patterns, or major content/IA change | Localized screen or flow change | Copy, label, or micro-interaction fix |

**Sort:** high impact + low effort first (quick wins), then high impact + high effort (strategic bets). Tie-break with Primary User Filter below.

## Evaluation rubrics

### Evidence Prioritization
- **When**: Multiple data sources suggest different actions.
- **Process**: Weight evidence by decision risk  ->  triangulate qual and quant  ->  prioritize actionable insights.
- **Pass**: Clear ranked recommendations with evidence cited.
- **Failure signals**: Analytics-only decisions; ignoring sample size limits.

### Primary User Filter
- **When**: Feature prioritization debates among multiple user types.
- **Process**: Ask: does this serve the primary user's goals? If no → deprioritize or cut. If yes → design fully for their scenario.
- **Pass**: Features ranked by primary user goal alignment.
- **Failure signals**: Designing for edge cases first; accommodating everyone equally → nobody satisfied.

Also used when reconciling persona panel conflicts — see [user-modeling](../lamina-user-modeling/SKILL.md) persona simulation.

## Related capabilities

- [User Modeling](../lamina-user-modeling/SKILL.md)
- [Feature Prioritization](../lamina-feature-prioritization/SKILL.md)
- [Research Communication](../lamina-research-communication/SKILL.md)
