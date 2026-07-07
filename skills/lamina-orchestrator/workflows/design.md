# /lamina-design workflow

Design net-new UX — whole product concept or a single feature spec. Dispatches to an internal track.

## Track detection

First strong match wins. Honor explicit override: `--track concept` or `--track feature`.

| Signal | Track |
|---|---|
| `--track concept` | [design-concept.md](design-concept.md) |
| `--track feature` | [design-feature.md](design-feature.md) |
| Problem only, no solution, early exploration, greenfield | concept |
| Specific feature or capability to add | feature |
| Ambiguous | Ask **one** question: *"Are you designing a whole product from a problem, or specifying one feature?"* Then dispatch |

## Procedure

0. **Init gate** — run [init-required](../prerequisites/init-required.md). On failure: emit `init-blocked` contract **verbatim** from `outputs/init-blocked.md` and **STOP**.
1. Detect track from input signals (table above).
2. Execute the chosen track through completion. Do not implement product code. UX guidance only.

## Subagent hints

Inherit from the dispatched track:
- **Concept:** fresh context for step 1; persona panel at step 4
- **Feature:** persona panel after flows; parallel review for accessibility + risks
- Default: inline sequential
