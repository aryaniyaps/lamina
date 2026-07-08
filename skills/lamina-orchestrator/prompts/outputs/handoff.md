Use this exact structure for `.lamina/runs/<run_id>/handoff.md`.

`handoff.md` is the final developer-facing artifact for a future coding session. It is not permission for the current Lamina command to edit app source code.

```markdown
---
id: handoff
title: Developer handoff
run_id: <run_id>
source_run: .lamina/runs/<run_id>/run.yaml
blueprint_id: <id or null>
confidence: <high|medium|low|blocked>
sources:
  - .lamina/runs/<run_id>/run.yaml
  - <artifact paths>
---

# Developer handoff: <target>

## Command Boundary
This Lamina command produced UX artifacts only. Do not edit app source code in this session. Start a separate coding-agent session to implement this handoff.

## Implementation Objective
What should change for users, stated as behavior and outcomes.

## Non-Goals
What should not be built or changed.

## Source Artifacts
- `run.yaml`: <path>
- `report.md`: <path>
- `blueprint`: <path or none>
- `artifact packs`: <paths>

## Screen And Flow Map

```mermaid
<flowchart derived from run.yaml flows/screens>
```

## Component Behavior Specs
For each affected screen/component:
- **Source:** `run.yaml` screen id and optional read-only repo source path.
- **States:** default, loading, empty, error, permission, success, or not applicable.
- **User actions:** triggers and outcomes.
- **Accessibility:** keyboard, focus, screen reader, contrast, reduced motion, error messaging.

## API And Data Interaction Assumptions
List data needs, side effects, and API assumptions. Cite source paths if brownfield references exist. Mark unknowns clearly.

## Acceptance Criteria
Map every item to `run.yaml` `checklist[]` or `findings[]` ids.

- `<checklist-or-finding-id>` — <acceptance criteria>

## Test Plan
- **Unit:** <logic or component behavior to test>
- **Integration:** <flow/data boundary to test>
- **E2E:** <critical user journey>
- **Accessibility:** <keyboard, screen reader, focus, WCAG checks>
- **Usability validation:** <tasks or follow-up research, not fabricated results>

## Risks And Deferred Questions
- <risk or unresolved question, with owner/source when known>

## Implementation Session Prompt
Start a new coding session with this handoff and the referenced `.lamina/` artifacts. The coding session may edit app code; the Lamina command that created this handoff must not.
```

## Required inputs

- Current `run.yaml`
- `checklist[]` for feature runs or `findings[]` for audit runs
- `flows[]` and `screens[]` when available
- Artifact index and selected artifact packs when generated
- Blueprint id when a blueprint was approved

If required inputs are missing, write `confidence: blocked`, explain what is missing, and do not invent implementation details.
