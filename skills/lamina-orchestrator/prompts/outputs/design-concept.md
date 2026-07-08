Use these exact headings. **Structured data** (flows, screens) lives in `run.yaml` — do not duplicate in `report.md`.

```markdown
## Design (concept): <problem>
### User model
Pointer to `.lamina/personas.yaml` if cast exists or was updated. Brief summary only.
### Journey
### Information architecture
Brief summary; IA tree data belongs in `run.yaml` `screens[]` when relevant.
### Flows
Brief summary only. Machine-readable: `run.yaml` `flows[]` and `screens[]`.
### Screens (structure and behavior)
Brief summary only. See `run.yaml` `screens[]` for element trees.
### Interactions
### Copy guidance
Tone and voice principles — not copy slots (those live in `run.yaml` `screens[].elements`).
### Accessibility considerations
### Validation plan
### Persona simulation notes
method: simulation | not_user_research: true | confidence: <high|medium|low>
Raw data in `run.yaml` `simulation`. Reconciled narrative here only.
### Open questions
```
