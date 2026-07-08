# /lamina-design workflow

Design net-new UX — whole product concept or a single feature spec. Dispatches to an internal track.

## Track detection

First strong match wins. Auto-route from prompt signals and project context — no `--track` flag.

| Signal | Track |
|---|---|
| `Problem:`, `Concept for`, whole-product nouns (app, product, platform), early exploration, greenfield | [design-concept.md](design-concept.md) |
| `Add`, `Implement`, `Spec`, scoped capability or flow on existing product | [design-feature.md](design-feature.md) |
| Audit signals (`redesign`, `improve`, `fix`, existing flow) | Route to [audit.md](audit.md) — not design |
| Ambiguous | Ask **one** question: *"Are you designing a whole product from a problem, or specifying one feature?"* Then dispatch |

**Weak prior** from `.lamina/business-context.md` frontmatter (`maturity: greenfield | brownfield`): greenfield + vague problem → concept; brownfield + `Add X` → feature.

**Disambiguation:** Say `concept for …` or `add … feature` to steer routing without flags.

## Procedure

0. **Init gate** — run [init-required](../prerequisites/init-required.md). On failure: emit `init-blocked` contract **verbatim** from `outputs/init-blocked.md` and **STOP**.
1. **Create run** — `.lamina/runs/<run_id>/run.yaml` per [artifacts.md](../artifacts.md). Set `hook` to `concept` or `feature` after track detection.
2. Detect track from input signals (table above).
3. Execute the chosen track through completion. Do not implement product code. UX guidance only.

## Subagent hints

Inherit from the dispatched track:
- **Concept:** fresh context for step 1; persona panel at step 4
- **Feature:** persona panel after flows; parallel review for accessibility + risks
- Default: inline sequential
