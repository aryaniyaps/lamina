Use this contract when generating `.lamina/runs/<run_id>/artifacts/<pack>-pack.md`.

Load `artifact-catalog.yaml` first. Include only artifacts that are relevant to the command scope and have enough inputs to generate responsibly. Do not generate every artifact by default.

```markdown
---
id: <pack>-pack
title: <Research|IA|Flow|Journey|Interaction|Validation|Accessibility|Strategy> artifact pack
pack: <research|ia|flow|journey|interaction|wireframe|validation|accessibility|strategy>
run_id: <run_id>
confidence: <high|medium|low|blocked>
artifact_ids:
  - <artifact id>
sources:
  - <path, run.yaml section, pasted source, or evidence id>
---

# <Pack title>

## Scope
What this pack covers and what it deliberately excludes.

## Artifact Work Plan
- **Generate:** <artifact ids with complete inputs>
- **Generate as plan/template:** <artifact ids missing real evidence but still useful as prep>
- **Delegate to subagent:** <artifact ids and why>
- **Blocked:** <artifact ids and missing inputs>
- **Skipped:** <artifact ids and why not relevant>

## Shared Evidence Ledger
- `<source id or path>` — <fact, quote, observation, run.yaml section, simulation result, or assumption>

## Artifacts

### <Artifact title>

Follow `outputs/artifact-template` for each included artifact. Every artifact must include a Mermaid diagram or explicitly say why the diagram is blocked.

## Cross-Artifact Implications
- <what the pack changes about flows, screens, IA, validation, accessibility, strategy, or handoff>

## Open Questions
- <questions that block higher-confidence artifacts or implementation>
```

## Quality bar

- Cite evidence from `.lamina/business-context.md`, `.lamina/personas.yaml`, current `run.yaml`, prior runs, attached sources, or explicit user input.
- Label assumptions and simulation separately from real user research.
- For testing outputs, do not claim sessions happened unless session observations were provided.
- For accessibility outputs, do not claim measurements were run unless inspected evidence exists.
- For IA/content outputs, distinguish product structure from proposed structure.
- Never write product code, app files, styles, tests, or configuration. Artifact packs live only under `.lamina/`.
