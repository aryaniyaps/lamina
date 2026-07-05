---
name: lamina-task-analysis
description: "Task Analysis UX guidance. Use when mapping user tasks and workflows; task navigation design; identifying deal-breaker tasks."
metadata:
  lamina:
    id: task-analysis
    problems:
      - "mapping user tasks and workflows"
      - "task navigation design"
      - "identifying deal-breaker tasks"
    related:
      - lamina-information-architecture
      - lamina-flow-design
      - lamina-requirements-definition
---
# Task Analysis

## When to load

- mapping user tasks and workflows
- task navigation design
- identifying deal-breaker tasks

## Decision frameworks

- **Harmonious Interactions (navigation strategies)**: Follow mental models; keep necessary tools close; provide choices not questions; avoid blank slates. - Use when designing navigation architecture. - How: Map nav to user tasks and objects, not internal team structure.
- **Index Panes and Content Navigation**: Separate wayfinding from work area—users select objects in index, manipulate in content. - Use in sovereign apps with many objects/documents. - How: Index pane for hierarchy; content pane for detail and editing.
- **Page-Based Interactions (Web)**: Web navigation as task flows across pages—minimize depth for key paths. - Use when designing web task flows. - How: Optimize critical paths; reduce clicks to working-set tasks.
- **Mobile Navigation Idioms**: Tab bars, drawers, and stacks for limited screen estate. - Use on mobile platforms. - How: Limit top-level destinations; preserve context during drill-down.
- **Design for the Probable but Anticipate the Possible**: Optimize common paths; don't hide edge cases entirely. - Use when simplifying navigation risks trapping power users. - How: Progressive disclosure for rare tasks; direct access for working-set tasks.

## Checklists

1. Navigate by user tasks and mental models, not org or implementation structure.
2. Optimize key-path navigation for perpetual intermediate working sets.
3. Separate index/wayfinding from content/work areas in sovereign apps.
4. Avoid blank slates—guide users toward first productive action.
5. Platform-specific navigation idioms (desktop, web, mobile) each have constraints.

## Heuristics

- **Task vs. feature navigation**: Users think "send invoice," not "Accounts Receivable module."
- **Working-set prominence**: Daily tasks get shortest paths.
- **Mental model alignment**: Navigation labels use user vocabulary.
- **Blank slate avoidance**: Empty states guide toward first productive action.
- **Contextualize information**: Show nav relevant to current task context.
- Navigation is**signage for tasks**, not a**map of the codebase**.
- Every click on a key path should feel**commensurate with reward**.
- **Blank slates**are missed onboarding opportunities. - **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Anti-patterns

- **Org-chart navigation**: Mirrors company structure, not user goals.
- **Implementation-model menus**: File/Edit/View when domain tasks differ.
- **Deep hierarchy for frequent tasks**: More than three clicks to daily actions.
- **Context-free global nav**: Same menu regardless of what user is doing.

## Related capabilities

- [Information Architecture](../lamina-information-architecture/SKILL.md)
- [Flow Design](../lamina-flow-design/SKILL.md)
- [Requirements Definition](../lamina-requirements-definition/SKILL.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](../lamina-decision-making/SKILL.md).
