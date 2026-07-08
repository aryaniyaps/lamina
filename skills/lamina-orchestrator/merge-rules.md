# Merge and delivery rules

## Work plan

Emit before heavy work (skip for quick takes). Use prompt: `prompts/work-plan.md`.

## Mandatory intake gate

Before emitting a work plan or writing any `.lamina/` artifact, classify missing inputs as **blocking** or **deferred**.

- **Blocking gaps** prevent responsible artifact generation: missing init foundation, design target, primary user, success outcome, scope boundary, audit target, or evidence needed to verify a cited UI.
- **Deferred gaps** can remain open without distorting the artifact: optional metrics, future research details, unresolved stakeholder preference, or evidence that is not needed for the requested scope.
- For blocking gaps, emit `prompts/outputs/clarify.md` with one concise batch of clarifying questions, then **STOP**. Do not create `run.yaml`, `report.md`, personas, artifact packs, findings, flows, screens, checklists, handoff files, or blueprint files.
- If the user explicitly refuses, skips, or asks to proceed without answering, continue only where the workflow permits assumption-backed or template output. Keep those unanswered items under **Open questions** and never resolve them through hidden assumptions.
- Do not treat the final **Open questions** section as a replacement for this gate.

## Merge order

problem → users → flows → structure → UI → edge cases → requirements → metrics → artifact packs → handoff → next steps

## Grounding and citations

- Every finding must name `@step/screen/element` or state `insufficient detail — cannot verify`.
- Do not invent UI not described in user input, repo context, or existing `.lamina/` artifacts.
- When the user cites a path (e.g. `@checkout/payment/cta`) without screenshots, routes, or repo context, respond with `insufficient detail — cannot verify` for that element — do not fabricate labels, states, or layout.
- Artifact packs must cite `.lamina/business-context.md`, `.lamina/personas.yaml`, current `run.yaml`, prior run files, attached sources, or explicit user input.
- Label real research, repo evidence, assumptions, and persona simulation separately.
- Do not invent interview quotes, participants, analytics, usability results, SUS scores, heatmaps, click maps, scroll maps, accessibility measurements, or benchmark data.

## Artifact subagent merge

Artifact subagents are readonly and return fragments only. The orchestrator:

1. Verifies each fragment against `artifact-catalog.yaml` and the requested artifact ids.
2. Downgrades confidence when required inputs are missing or evidence is assumption-only.
3. Deduplicates shared evidence into `run.yaml` `evidence[]` or `evidence.md`.
4. Merges fragments into `artifacts/<pack>-pack.md` using `prompts/outputs/artifact-pack.md`.
5. Adds every written artifact to `run.yaml` `artifacts[]`.
6. Compiles `handoff.md` last, after checklist/findings and artifact packs are available.

Never let subagents write files directly or edit files outside `.lamina/`.

## Conflicts

**On conflict:** Load [lamina-decision-making](../lamina-decision-making/SKILL.md). Apply primary-user filter and evidence triangulation.

**Unresolved:** List under **Open questions** in the final output. Never silently pick a side.

**Conflict record (when needed):**

```markdown
- **Conflict:** …
- **Sources:** …
- **Resolution:** …
- **Confidence:** high | medium | low
```

## Default output template

Use when no command-specific contract applies (see `prompts/outputs/` for command contracts):

```markdown
## UX recommendation
### Problem framing
### Key insights
### Recommendations (prioritized)
### Conflicts resolved
### Open questions
### Suggested next steps
```

## Optional confirm gate

Before final delivery: *"Does this framing match your goal? Adjust or confirm."* Skip if the user asked for a quick take or full pass without gates.
