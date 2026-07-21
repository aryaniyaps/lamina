---
name: lamina
description: "Use only when explicitly invoked as lamina. Route product design for developers building with AI — design, verify, or direct capability answers."
---

# /lamina

## Product

Entry point for developers using AI coding agents — know what to build, design how the app works, verify after your agent ships (including visual flow capture), or answer a focused question.

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
| Verify / audit | **audit**, **findings**, **prioritized** improvements |
| Direct capability | `lamina-<skill-id>` by name |
| Ambiguous | ask: new UX, existing UX, or focused question |

## Guardrail

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor application source. See [guardrails](../lamina-core/guardrails.md).

## Step 0 — Init gate when routing to design or verify

Before dispatching to [design.md](../lamina-orchestrator/workflows/design.md) or [verify.md](../lamina-orchestrator/workflows/verify.md), run [init-required](../lamina-orchestrator/prerequisites/init-required.md).

**If init validates** (`.lamina/business-context.md` exists and passes validation): **read it from disk** with your file tool, then proceed to the chosen workflow. Do **not** emit `## Lamina: init required`.

- **Problem exploration** (“don't know what to build”, early ideation): route to design — frame the user problem, mention **design workflow**, **flows**, and **edge cases**; use design output headings when shaping (`### Domain and invariants`, etc.) or explicitly dispatch `/lamina-design`.
- **Specific feature**: route to design with flows/edge cases vocabulary.
- **Verify/audit**: route to verify with **audit**, **findings**, **prioritized** improvements.

**If init fails**, emit this contract as your **only** response and **STOP**:

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
