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

1. Emit work plan — prompt `work-plan`.
2. **Frame** — resolve business sections via user input; one batch of clarifying questions for gaps (see question bank in lamina-business-context).
3. **Evidence** (brownfield only) — scan README, docs, user-facing code per brownfield scan protocol; large corpus → [fresh-context](../patterns/fresh-context.md). Write findings into **Inferred context** section only.
4. **Write** — create `.lamina/business-context.md` with frontmatter (`maturity`, `platform`, `last_updated`). See [artifacts.md](../artifacts.md).
5. Merge into output contract — prompt `outputs/init`.
6. Recommend next command in output only — not persisted.

## Procedure — update

1. Read existing `.lamina/business-context.md` and changelog.
2. Identify changed sections from user input.
3. Re-apply skills for changed sections only (see staleness table in lamina-business-context).
4. Merge updates — preserve unchanged sections.
5. Append changelog entry.
6. Flag stale downstream artifacts (`personas.yaml`, `flows-inventory.yaml`, etc.).
7. If conflicts with `.lamina/decisions.md`, load `lamina-decision-making`.
8. Merge into output contract — prompt `outputs/init`.

## Subagent hints

- **Fresh context:** large doc corpus on brownfield establish/update → [fresh-context](../patterns/fresh-context.md)
- Default: inline sequential

## Guardrail

UX artifacts only. Do not create `config.yaml`, `insights.md`, `personas.yaml`, `flows-inventory.yaml`, or empty stubs.
