Use these exact headings. **Structured findings** live in `run.yaml` — do not duplicate tables in `report.md`.

```markdown
## UX audit: <flow(s)>
### Executive summary
### Findings by flow
Narrative synthesis. Machine-readable prioritized list: `run.yaml` `findings[]`.
### Prioritized improvements
Brief summary only — see `run.yaml` `findings[]` for id, priority, impact, effort, recommendation.
### Quick wins
### Strategic bets
### Persona simulation notes
method: simulation | not_user_research: true | confidence: <high|medium|low>
### Artifact packs
Brief summary only. Diagram-backed audit, validation, accessibility, flow, or handoff artifacts: `.lamina/runs/<run_id>/artifacts/`. Do not duplicate artifact bodies in `report.md`.
### Open questions
Only deferred or explicitly unanswered questions after the user answered the audit target gate or chose to proceed with insufficient detail. Do not use this section instead of asking blocking questions upfront.
### Coding handoff
- UX artifacts are complete — do not implement product code in this session
- Start a separate coding session using `.lamina/runs/<run_id>/handoff.md`, `run.yaml` findings, and/or blueprint handoff
- Artifacts: `.lamina/runs/<run_id>/`
- Source writes during this Lamina command were limited to `.lamina/`
```
