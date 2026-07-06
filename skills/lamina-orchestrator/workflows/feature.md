# /lamina-feature workflow

Turn a feature idea into an implementation-ready UX spec with risks, accessibility, and success criteria.

## Input

- Feature idea (required)
- Optional: existing product context, primary user, constraints

## Sections and profiles

| Section | Profile |
|---|---|
| Problem definition | `feature-problem` |
| Jobs to be done | `feature-jobs` |
| Assumptions | `feature-assumptions` |
| User goals | `feature-goals` |
| Flows | `feature-flows` |
| Edge cases | `feature-edge-cases` |
| Risks | `feature-risks` |
| Accessibility review | `feature-a11y` |
| Success metrics | `feature-metrics` |
| Implementation checklist | `feature-checklist` |

Resolve skills from [audit-profiles.yaml](../audit-profiles.yaml).

## Procedure

0. If `.lamina/business-context.md` exists, read it — align problem definition and scope with business context. If missing, note the gap; do not auto-run init.
1. Emit work plan — prompt `work-plan`.
2. Work through sections in order (problem → flows).
3. **After flows:** Append feature flows to `.lamina/flows-inventory.yaml` (`status: planned`) per [artifacts.md](../artifacts.md). [persona-panel](../patterns/persona-panel.md) if `.lamina/personas.yaml` exists; feed conflicts into Risks.
4. Continue remaining sections.
5. Accessibility and risks: [parallel-review](../patterns/parallel-review.md) if host supports it.
6. Merge into output contract — prompt `outputs/feature`.
7. On conflicts, load `lamina-decision-making`.

Implementation checklist: actionable UX tasks with acceptance criteria. No product code.

## Subagent hints

- **Persona panel:** after flows
- **Parallel review:** accessibility + risks (+ optionally trust)
- Default: inline sequential
