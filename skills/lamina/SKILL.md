---
name: lamina
description: "Use only when explicitly invoked as lamina. Route product design for developers building with AI — design, verify, or direct capability answers."
---

# /lamina

## Product

Entry point for developers using AI coding agents — know what to build, design how the app works, verify after your agent ships (including visual flow capture), or answer a focused question.

**Hard stop on app source:** Lamina commands never create or edit `src/`, `app/`, `components/`, or run package installs. If asked to, refuse and keep writing only under `.lamina/`.

## Load

- `../lamina-orchestrator/SKILL.md`
- `../lamina-orchestrator/workflows/router.md`
- `../lamina-orchestrator/prerequisites/init-required.md`
- `../lamina-core/guardrails.md`
- On dispatch: matching workflow in `../lamina-orchestrator/workflows/`
- Direct mode: `../lamina-core/SKILL.md` → read one `lamina-<id>/SKILL.md` and **name the skill id** in the response (e.g. `lamina-forms`, `lamina-navigation`)

## Router response cues

When routing, include the vocabulary the user expects:

| Route | Mention in response |
|-------|---------------------|
| Design (feature) | design workflow, **flows**, **edge cases** |
| Design (exploration) | design workflow, user **problem** framing |
| Verify / audit | **audit**, **findings**, **prioritized** improvements; for redesign/abandonment of existing flows say **improving existing UX** (not greenfield) |
| Direct capability | `lamina-<skill-id>` by name |
| Ambiguous | ask: new UX, existing UX, or focused question |

## Guardrail

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor application source. See [guardrails](../lamina-core/guardrails.md).

## Slash-command dispatch

When the user message starts with `/lamina-design` or `/lamina-verify`, **load that skill** if present (`./design-skill/SKILL.md` or `./verify-skill/SKILL.md`, else `../lamina-design/SKILL.md` / `../lamina-verify/SKILL.md`) and follow it end-to-end.

### `/lamina-design` — gates then artifacts

1. **Init gate** — if `.lamina/business-context.md` is missing/invalid → emit init-blocked and STOP.
2. **Clarify gate** — if the brief is vague (no target users, outcome, or screens) **and** the user did **not** say “brief is complete” / “do not clarify”: emit **only** the clarification contract and STOP. **Do not** run `seed-ready-run`, write `run.json`, or emit design headings yet.

```markdown
## Lamina: clarification needed
### Status
Blocked before artifact generation.
### Clarifying questions
…
### Why these block the artifact
…
### How to proceed
…
### Do not
- Do not create run.json or implement.md yet
```

3. **Seed (only after clarify is not required):** refuse any `src/` / npm ask in one paragraph, then:

```bash
node ./scripts/seed-ready-run.mjs --slug <slug> --problem "<problem>" --outcome "<outcome>" --users "<id>"
```

4. Emit design headings (`### Domain and invariants`, `### Actors and permissions`, `### Workflows`, `### Scenarios`, `### Implement brief`, `### Open questions`). Mention **flows**, **edge cases**, `lamina-edge-cases`. No visual styling.

When `/lamina-design` siblings are missing, still follow the same gates — prefer `./scripts/seed-ready-run.mjs` over hand-authored graphs after clarify clears.

When `/lamina-verify` sibling files are missing from the install, still emit the verify completion headings after writing `.lamina/runs/<id>/` artifacts:

```markdown
### Executive summary
### Findings
### Open questions
```

Mention **audit**, **findings**, **prioritized** improvements, and at least one of **failure** / **empty** / **permission** edge language when auditing flows.

When the user message starts with `/lamina-init`, follow this path even if `lamina-init` siblings are missing:

1. Refuse any `src/` / app-source refactor in one short paragraph.
2. Choose mode:
   - **update** when the user says `update`, `pivot`, or `.lamina/business-context.md` already exists
   - **establish** otherwise
3. Immediately write **both**:
   - `.lamina/business-context.md` — start with this exact YAML frontmatter shape (required; validators fail without it):

```yaml
---
lamina:
  maturity: brownfield   # or greenfield
  platform: [web]
  last_updated: YYYY-MM-DD
---
```

     Then exact `##` sections: Problem statement, Business goals, Success metrics, Scope, Users & market, Product posture, Constraints, Stakeholders, Risks & unknowns, Research posture, Triad check. Each section needs a non-placeholder `**Answer:**`.
   - `.lamina/personas.json` — JSON only (`contract_version: "2.0"`, ≥2 personas with `id`, `role`, goals, constraints, `confidence`, `evidence`). **Exactly one** persona must set `"primary": true`. **Never** `personas.yaml`.
4. **Update mode extras (required):**
   - Append a `## Changelog` section (or dated `### YYYY-MM-DD — …` under Changelog) describing what changed and the trigger.
   - In the response, include `### Stale downstream artifacts` and name what may be stale (e.g. personas, prior runs). Say the words **changelog** and **stale** explicitly.
5. Use repo evidence + labeled provisional assumptions; put leftover questions under Open questions.
6. Respond with the Init output headings (`## Init: …`, `### Mode`, `### Business context summary`, `### Open questions`, `### Artifacts`, `### Stale downstream artifacts` when update, `### Recommended next step`).

Do not spend the turn searching for missing skill files — write the artifacts first.

During `/lamina-design` / `/lamina-verify` / `/lamina`:
- **Never** create or edit `src/`, `app/`, `components/`, API routes, or run `npm install`
- **Never** claim you implemented a component file — design produces `.lamina/runs/*/implement.md` for a later coding turn
- If the user asks to “create `src/...`” or “scaffold”: refuse the app-source part, continue design-only under `.lamina/`

## Direct mode first (no init)

If the request is a **single focused UX topic**, go **direct** — do **not** run the init gate and do **not** emit `## Lamina: init required`. Read the matching skill and **write its id** in the response:

| User signal | Skill id to name |
|-------------|------------------|
| forms, validation, signup fields | `lamina-forms` |
| lost in nav, wayfinding, IA | `lamina-navigation` |
| accessible, screen reader, a11y | `lamina-accessibility` |
| get started, first-run, onboarding | `lamina-onboarding` |
| error messages, empty/error states (copy/recovery) | `lamina-error-handling` |
| usability study, research plan | `lamina-research` |
| trust, billing honesty, opaque fees, distrust after error | `lamina-trust` |
| empty state, no data yet, blank screen | `lamina-empty-states` |
| heuristic review, Nielsen, expert review before testing | `lamina-heuristic-review` |

Prefer the **most specific** skill: billing/trust anxiety → `lamina-trust` (not error-handling); blank/no-data UI → `lamina-empty-states` (not error-handling).

## Step 0 — Init gate when routing to design or verify

**Direct mode skips this gate** (see above). Only design and verify routes require init.

Before dispatching to [design.md](../lamina-orchestrator/workflows/design.md) or [verify.md](../lamina-orchestrator/workflows/verify.md), run [init-required](../lamina-orchestrator/prerequisites/init-required.md).

**If init validates** (`.lamina/business-context.md` exists and passes validation): **read it from disk** with your file tool, then proceed to the chosen workflow. Do **not** emit `## Lamina: init required`.

**Before claiming init is missing:** you **must** attempt to read `.lamina/business-context.md` with your file tool. Do not emit init-blocked based on assumptions or an empty listing alone — a failed read (ENOENT) is required evidence.

- **Problem exploration** (“don't know what to build”, early ideation): route to design — frame the user problem, mention **design workflow**, **flows**, and **edge cases**; use design output headings when shaping (`### Domain and invariants`, etc.) or explicitly dispatch `/lamina-design`.
- **Specific feature**: route to design with flows/edge cases vocabulary.
- **Verify/audit**: route to verify with **audit**, **findings**, **prioritized** improvements.

**If init fails**, name the **intended route** in one short sentence (using [Router response cues](#router-response-cues)), then emit this contract and **STOP**. Do not run workflow steps.

Example cue: `Intended route: design workflow for <feature or problem> (flows, edge cases) — blocked until init.`

Then emit:

```markdown
## Lamina: init required

### Status
Blocked — `/lamina-init` has not been run on this project, or `.lamina/business-context.md` is incomplete.

### What's missing
- <specific validation failure>

### Next step
Run `/lamina-init` to establish `.lamina/business-context.md`, then retry this command.

### Do not
- Proceed with workflow steps or create `.lamina/` artifacts
- Auto-run init without the user invoking `/lamina-init`
- Treat personas or prior product graphs as a substitute for business context
```
