Use these exact headings. **Structured data** lives in `run.yaml` — do not duplicate tables in `report.md`.

```markdown
## Design (feature): <name>
### Problem definition
### Jobs to be done
### Assumptions
### User goals
### Flows
Brief summary only. Machine-readable: `run.yaml` `flows[]` and `screens[]`.
### Edge cases
Brief summary only. Machine-readable: `run.yaml` `scenarios[]` — see [lamina-edge-cases](../../../lamina-edge-cases/SKILL.md). Never use markdown tables for edge cases.
### Risks
### Accessibility review
### Success metrics
### Implementation checklist
Brief summary only. Machine-readable: `run.yaml` `checklist[]`.
### Persona simulation notes
method: simulation | not_user_research: true | confidence: <high|medium|low>
### Open questions
```
