# /lamina-init workflow

Establish or update the business foundation UX work needs — problem, goals, scope, users, constraints, metrics — persisted in `.lamina/business-context.md`.

## Input

- **Establish:** optional product description, docs, or repo context
- **Update:** what changed (pivot, new market, scope shift) — or `/lamina-init update`

## Mode detection

| Condition | Mode |
|---|---|
| No `.lamina/business-context.md` | establish |
| User says update, pivot, scope change, or `update` | update |
| File exists and no update intent | establish only if user asks to re-bootstrap; otherwise confirm update vs replace |

## Skills

Resolve from profile `init` in [audit-profiles.yaml](../audit-profiles.yaml). Load [lamina-business-context](../../lamina-business-context/SKILL.md) for section mapping and protocols.

Map skills to sections per business-context skill. Load all inline for establish; subset for update based on changed sections.

## Procedure — establish

1. **Frame gate**
    - **Interactive (humans answering):** resolve business sections via user input; one batch of clarifying questions for gaps (see question bank in lamina-business-context). At minimum, require enough signal for Problem statement, Scope, Users & market, Product posture, and Constraints. If any are missing, emit `outputs/clarify` and **STOP** before writing `.lamina/business-context.md` or `.lamina/personas.yaml`. Prefer asking — answers feed research/intake quality downstream.
    - **Agent-primary / unattended:** if the attached brief already covers goals, users/actors, scope, and constraints, **do not** clarify-and-STOP. Write a structured extract into `business-context.md` with clearly labeled assumptions (`confidence: low|medium`) and list residual gaps under **Open questions**.
2. **Skip/refusal handling** — if the user explicitly refuses, skips, or asks to proceed without answering blocking questions, continue only with clearly labeled low-confidence assumptions and preserve unanswered items under **Open questions**. Do not silently fill missing core sections.
3. Emit work plan — prompt `work-plan`.
4. **Evidence** (brownfield only) — scan README, docs, and user-facing code per brownfield scan protocol; large corpus → [fresh-context](../patterns/fresh-context.md). Brownfield files are read-only evidence; never modify source. Write findings into **Inferred context** section only.
5. **Write** — create `.lamina/business-context.md` with frontmatter (`maturity`, `platform`, `last_updated`). See [artifacts.md](../artifacts.md). Keep it a **short extract**, not a near-copy of a long brief.
6. **Cast** — infer personas from available evidence and Users & market section. Load [lamina-user-modeling](../../lamina-user-modeling/SKILL.md). Write `.lamina/personas.yaml` per Cast protocol in [artifacts.md](../artifacts.md). Brownfield: ground in scan findings. Greenfield: ground in user input / attached PRD. Provisional personas get `confidence: low|medium`. If file already exists, append only.
7. Merge into output contract — prompt `outputs/init`.
8. Recommend next command in output only — not persisted. Do not offer to implement source changes in the init session.

## Procedure — update

1. Read existing `.lamina/business-context.md` and changelog.
2. Identify changed sections from user input.
3. Re-apply skills for changed sections only (see staleness table in lamina-business-context).
4. Merge updates — preserve unchanged sections.
5. Append changelog entry.
6. Flag stale downstream artifacts (`personas.yaml`, prior runs, etc.).
7. If conflicts with `.lamina/decisions.md`, load `lamina-decision-making`.
8. Merge into output contract — prompt `outputs/init`.

## Subagent hints

- **Fresh context:** large doc corpus on brownfield establish/update → [fresh-context](../patterns/fresh-context.md)
- Default: inline sequential

## Guardrail

Writes: `.lamina/` only. Repo: read-only. Do not create `config.yaml`, `insights.md`, source edits, tests, config, styles, docs outside `.lamina/`, or empty stubs outside `.lamina/`.
