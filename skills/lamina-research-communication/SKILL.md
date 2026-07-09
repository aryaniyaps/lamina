---
name: lamina-research-communication
description: "Findings communication — structured verify report for humans and coding agents. Not executive highlight reels."
metadata:
  lamina:
    id: research-communication
    problems:
      - "present verify results"
      - "actionable findings report"
    related:
      - lamina-research-synthesis
      - lamina-verify
---
# Findings Communication (agent-native)

`report.md` and `findings[]` must be **actionable for the next implementer** — not slide decks.

## Structure

1. **Summary** — pass/fail per workflow, top blockers
2. **Evidence** — walkthrough refs, actor walk excerpts, repo paths
3. **Findings** — severity, repro steps, suggested contract or code fix
4. **Open assumptions** — what still needs human confirmation

## Anti-patterns

- **Highlight reels** — video sizzle without repro steps
- **Vague UX feedback** — "feels confusing" without screen + operation

## Related

- [Simulation Synthesis](../lamina-research-synthesis/SKILL.md)
