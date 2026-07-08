# Artifact subagents

**When:** The workflow needs one or more diagram-backed artifact packs and the work can be split by artifact domain after required inputs are known.

**What:** Dynamic readonly artifact writers return evidence-cited markdown fragments to the orchestrator. The orchestrator merges, resolves conflicts, writes files under `.lamina/`, and updates `run.yaml` `artifacts[]`.

**Catalog:** Load [artifact-catalog.yaml](../artifact-catalog.yaml) before spawning. Do not spawn for an artifact until its required inputs are present or the intended output is explicitly a plan/template/blocker artifact. `assumption_allowed` means assumptions are permitted after intake; it does not bypass the clarify gate.

## Routing

| Pack | Preferred agent | Typical inputs |
|---|---|---|
| research | `agents/research-artifact-writer.md` | research corpus, objective, user segment, evidence ledger |
| ia | `agents/ia-artifact-writer.md` | screens, routes, content sources, user tasks |
| journey | `agents/journey-artifact-writer.md` | personas, flows, touchpoints, lifecycle stages |
| interaction | `agents/interaction-artifact-writer.md` | `run.yaml` screens, transitions, scenarios, states |
| validation | `agents/validation-artifact-writer.md` | test goals, tasks, session/audit evidence when available |
| accessibility | `agents/validation-artifact-writer.md` | inspected screens, semantic structure, WCAG scope |
| strategy | `agents/strategy-artifact-writer.md` | business context, goals, opportunities, assumptions |
| handoff | `agents/handoff-compiler.md` | `run.yaml`, artifact index, checklist/findings, blueprint id |

## Spawn rules

1. Build an artifact work plan: generate, generate-as-template, delegate, blocked, skip.
2. For every missing input, classify whether it is a blocking intake gap or a deferred artifact gap. Blocking intake gaps must return to `outputs/clarify` before any subagent spawn.
3. Spawn one readonly subagent per independent pack or artifact. Parallelize when there are no dependencies.
4. Include these fields in every spawn prompt:
   - **Artifact ids:** catalog keys to produce.
   - **Run id:** current run.
   - **Inputs:** exact source paths, `run.yaml` sections, pasted evidence, and assumptions.
   - **Evidence mode:** from `artifact-catalog.yaml`.
   - **Output mode:** findings, plan/template, or blocked.
   - **Write boundary:** readonly; return fragments only.
5. Subagents must not write files. They return markdown fragments following `prompts/outputs/artifact-template.md`.
6. The orchestrator owns:
   - conflict resolution,
   - confidence normalization,
   - Mermaid syntax cleanup,
   - final file writes under `.lamina/runs/<run_id>/`,
   - `run.yaml` `evidence[]` and `artifacts[]` updates.

## Block instead of hallucinating

If a required input is missing, the subagent returns:

```markdown
## Artifact blocked
- **Artifact:** <id>
- **Missing inputs:** <required inputs>
- **Allowed fallback:** <plan/template/skip>
- **Need from orchestrator:** <specific source or user answer>
```

Never invent interview quotes, participants, analytics, usability results, SUS scores, heatmaps, click maps, scroll maps, accessibility measurements, or benchmark data.

For `assumption_allowed` artifacts, default to plan/template or blocked output until the user has answered the blocking intake questions or explicitly chosen to proceed with labeled assumptions. Confidence for assumption-backed artifacts is capped at medium.

## Conflict handling

When artifact subagents disagree, the orchestrator loads `lamina-decision-making`, records the conflict in `.lamina/decisions.md` with `run_id`, and surfaces the unresolved risk in `handoff.md`.

## Command boundary

All artifact subagents are readonly. Lamina commands may only write `.lamina/` artifacts, and only the orchestrator performs those writes.
