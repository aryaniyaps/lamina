Use these exact headings. **Structured data** (flows, screens, scenarios, checklist) lives in `run.yaml` — do not duplicate tables in `report.md`.

```markdown
## Design: <target>
### Problem framing
Business goal, user problem, constraints, and the design outcome in brief.
### Users and jobs
Pointer to `.lamina/personas.yaml` if cast exists or was updated. Brief summary only.
### Assumptions and evidence
Separate evidence, inference, and assumptions. Cite `.lamina/business-context.md`, sources, or state missing evidence.
### Journey and information architecture
Brief summary; IA tree data belongs in `run.yaml` `screens[]` when relevant.
### Flows
Brief summary only. Machine-readable: `run.yaml` `flows[]` and `screens[]`.
### Screens (structure and behavior)
Brief summary only. See `run.yaml` `screens[]` for element trees. No visual styling specs.
### Interactions and copy
Controls, feedback, form behavior, labels, and tone principles — not visual styling.
### Edge cases and recovery
Brief summary only. Machine-readable: `run.yaml` `scenarios[]` when concrete operations exist. Never use markdown tables for edge cases.
### Risks and decisions
Material trade-offs, trust risks, unresolved conflicts, and decision log pointers.
### Accessibility review
Keyboard, screen reader, cognitive load, reduced motion, and inclusive defaults.
### Metrics and validation
Success metrics, usability test tasks, and research plan.
### Artifact packs
Brief summary only. Diagram-backed artifacts: `.lamina/runs/<run_id>/artifacts/`. Do not duplicate artifact bodies in `report.md`.
### Developer handoff
Brief summary only. If written, implementation brief: `.lamina/runs/<run_id>/handoff.md`. It is for a separate coding session; do not implement product code in this Lamina session.
### Persona simulation notes
method: simulation | not_user_research: true | confidence: <high|medium|low>
Raw data in `run.yaml` `simulation`. Reconciled narrative here only.
### Open questions
Only deferred or explicitly unanswered questions after the user answered the intake gate or chose to proceed with assumptions. Do not use this section instead of asking blocking questions upfront.
```
