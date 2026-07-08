Use this exact structure for one artifact markdown file under `.lamina/runs/<run_id>/artifacts/`.

Before writing, load `artifact-catalog.yaml` and verify required inputs. If required evidence is missing, write a planning/template artifact only and mark `confidence: blocked` or `low`.

```markdown
---
id: <artifact_id>
title: <human title>
artifact_type: <catalog key>
pack: <research|ia|flow|journey|interaction|wireframe|validation|accessibility|strategy|handoff>
run_id: <run_id>
evidence_mode: <evidence_required|assumption_allowed|simulation_or_evidence|run_yaml_required>
confidence: <high|medium|low|blocked>
sources:
  - <path, run.yaml section, pasted note id, or research source>
diagrams:
  - <mermaid type>
---

# <Artifact title>

## Purpose
What decision this artifact supports.

## Inputs Checked
- **Required inputs:** <present/missing list>
- **Optional inputs used:** <list or none>
- **Evidence standard:** <what was required and whether it was met>

## Evidence Ledger
- `<source id or path>` — <fact, quote, observation, run.yaml section, or assumption>

Do not invent quotes, participants, analytics, usability results, SUS scores, heatmaps, click maps, scroll maps, accessibility measurements, or benchmark data. If a source is missing, say so.

## Diagram

```mermaid
<diagram using the catalog's diagram type>
```

## Findings Or Structure
The artifact content. Separate observations from interpretations. Label assumptions.

## Design Implications
- <specific implication for flows, screens, content, accessibility, validation, or handoff>

## Missing Evidence
- <what would increase confidence or unblock a findings-grade artifact>

## Confidence
**<high|medium|low|blocked>** — <one sentence explaining evidence quality and limits>
```

## Evidence rules

- `evidence_required`: If no evidence exists, do not produce findings. Produce a plan, guide, template, or blocked artifact.
- `assumption_allowed`: State assumptions explicitly and keep confidence no higher than `medium` unless backed by sources.
- `simulation_or_evidence`: Identify whether the source is real user evidence or persona simulation.
- `run_yaml_required`: Use `run.yaml` as the source of truth. Do not copy unsupported details from `report.md`.

## Mermaid rules

- Use only Mermaid fenced code blocks.
- Prefer the catalog diagram type; if you use a fallback, explain why in `Missing Evidence`.
- Keep node IDs simple: no spaces, angle brackets, or reserved words.
- Do not use custom styling, colors, `classDef`, or `click` syntax.
