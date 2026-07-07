# Merge and delivery rules

## Work plan

Emit before heavy work (skip for quick takes). Use prompt: `prompts/work-plan.md`.

## Merge order

problem → users → flows → structure → UI → edge cases → requirements → metrics → next steps

## Grounding and citations

- Every finding must name `@step/screen/element` or state `insufficient detail — cannot verify`.
- Do not invent UI not described in user input, repo context, or existing `.lamina/` artifacts.
- When the user cites a path (e.g. `@checkout/payment/cta`) without screenshots, routes, or repo context, respond with `insufficient detail — cannot verify` for that element — do not fabricate labels, states, or layout.

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
