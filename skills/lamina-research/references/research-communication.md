# Findings Communication (agent-native)

Graph-resident findings and any report/fix query projections must be
**actionable for the next implementer** — not slide decks. The projections are
never read back as canonical state.

## Structure

1. **Summary** — pass/fail per workflow, top blockers
2. **Evidence** — walkthrough refs, actor walk excerpts, repo paths
3. **Findings** — severity, repro steps, suggested contract or code fix, `fix_target`
4. **Open assumptions** — what still needs human confirmation

A fix projection is derived from finding Resources — every product finding must
appear with acceptance criteria and its GraphVersion.

## Anti-patterns

- **Highlight reels** — video sizzle without repro steps
- **Vague UX feedback** — "feels confusing" without screen + operation
