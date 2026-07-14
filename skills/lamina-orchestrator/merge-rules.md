# Merge and delivery rules

## Work plan

Emit before heavy work (skip for quick takes). Use prompt: `prompts/work-plan.md`.

## Mandatory intake gate

Before emitting a work plan or writing any `.lamina/` artifact, classify missing inputs as **blocking** or **deferred**.

- **Blocking gaps:** missing init foundation, design target, primary actor, success outcome, scope boundary, or evidence needed to verify a cited UI.
- **Deferred gaps:** optional metrics, unresolved preferences, evidence not needed for scope.
- For blocking gaps, emit `prompts/outputs/clarify.md`, then **STOP**. Do not create `run.yaml`, `report.md`, personas, `implement.md`, or flows.
- If the user explicitly skips blocking questions, continue only with assumption-backed output; cap confidence at medium; list gaps under **Open questions**.

## Merge order

**Design (`/lamina-design`):**

```
domain + invariants → actors + resource_filters → workflows → **dependencies (modes + requires)** → scenarios (acceptance + dependency_ref) → screens → seed/out_of_scope → contract simulation → validate-run → ready_to_build + ship-pack implement.md (Reachability graph first)
```

**Verify (`/lamina-verify`):**

```
load design contract → walkthrough (live product) → actor walks + a11y + invariant + reachability probes → findings → complete
```

## Grounding and citations

- Every finding must name `@step/screen/element`, contract id, or state `insufficient detail — cannot verify`.
- Do not invent UI not described in user input, repo, walkthrough pack, or `run.yaml`.
- When `walkthrough/` exists (`evidence[].kind: visual_walkthrough`), treat captured steps as primary grounding.
- Reject visual evidence tagged `source: blueprint` or `source: studio` — only `source: product` and `mode: live_app`.
- Label repo evidence, assumptions, and actor simulation separately.
- Do not invent interview quotes, analytics, SUS scores, or benchmark data.

## Conflicts

**On conflict:** Load [lamina-decision-making](../lamina-decision-making/SKILL.md). Apply primary-actor filter.

**Unresolved:** List under **Open questions**. Never silently pick a side.

## Default output template

```markdown
## Product design recommendation
### Domain and rules
### Key insights
### Recommendations (prioritized)
### Conflicts resolved
### Open questions
### Suggested next steps
```
