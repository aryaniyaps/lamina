# /lamina-feature

## Product

Turn a feature idea into an implementation-ready UX spec with risks, accessibility, and success criteria.

## Use when

- You have a feature idea to specify before build
- You need flows, edge cases, risks, a11y, metrics, and a checklist in one deliverable
- Adding a specific capability to an existing product

## Input

- Feature idea (required)
- Optional: existing product context, primary user, constraints

## Load

- `lamina/orchestration.md`
- Capabilities per output section:

| Section | Capabilities |
|---|---|
| Problem definition | `feature-discovery`, `problem-framing` |
| Jobs to be done | `user-modeling`, `task-analysis` |
| Assumptions | `research-scoping`, `problem-framing` |
| User goals | `user-modeling` |
| Flows | `flow-design`, `task-analysis` |
| Edge cases | `error-handling`, `empty-states`, `feedback-and-status` |
| Risks | `trust`, `stakeholder-alignment`, `persuasion-and-groups` |
| Accessibility review | `accessibility` |
| Success metrics | `quantitative-validation`, `research-communication` |
| Implementation checklist | `requirements-definition` |

Paths: `lamina/capabilities/<id>.md`

## Steps

1. Emit a short Lamina work plan.
2. Work through sections in order (problem definition → flows).
3. **After flows:** Run **persona panel** on the feature flow if `.lamina/personas.yaml` exists (one subagent per persona, parallel). Write `.lamina/personas/simulations/<run_id>.yaml`; feed conflicts into the Risks section.
4. Continue remaining sections (edge cases → implementation checklist).
5. For accessibility and risks: same feature target — use **parallel review** if the host supports it; otherwise inline sequential.
6. Merge into output contract; use `decision-making` on conflicts.

## Output

Use these exact headings:

```markdown
## Feature: <name>
### Problem definition
### Jobs to be done
### Assumptions
### User goals
### Flows
### Edge cases
### Risks
### Accessibility review
### Success metrics
### Implementation checklist
### Persona simulation notes
### Open questions
```

Implementation checklist: actionable UX tasks with acceptance criteria. No product code.

## Subagent hints

- **Persona panel:** after flows — one subagent per persona, parallel; see `orchestration.md`
- **Parallel review:** accessibility + risks (and optionally `trust`) on the same feature — if host supports parallel tasks
- Default: inline sequential
