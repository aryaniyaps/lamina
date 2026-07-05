# /lamina

## Product

One entry point that detects what you need and runs the right workflow — or answers a single-topic UX question directly.

## Use when

- You are not sure which Lamina workflow fits
- You want Lamina to route ideation, feature spec, audit, or a focused capability answer
- Default entry for the Lamina plugin

## Input

- Free-form user message (required)
- Optional arguments after the command

## Load

- `lamina/orchestration.md`
- `lamina/SKILL.md` (Problem Router for direct mode)
- On dispatch: the target workflow command file from `commands/`

## Steps

1. Parse the user message for intent signals.
2. Route (first strong match wins):

| Signal | Dispatch |
|---|---|
| Problem only, no solution, early exploration | Follow `commands/lamina-ideate.md` |
| Specific feature or capability to add | Follow `commands/lamina-feature.md` |
| Improve, audit, review, optimize existing UI or flows | Follow `commands/lamina-optimize.md` |
| Single clear topic (forms, personas, interviews, navigation, etc.) | **Direct mode** — `reference.md` → one capability from Problem Router |
| Ambiguous | Ask **one** question only: *"Are you (1) exploring a problem, (2) specifying a feature, or (3) improving something that exists?"* Then dispatch |

3. Execute the chosen path through completion.
4. Do not implement product code. UX guidance only.

## Output

- Delegates to the child workflow output contract (`lamina-ideate`, `lamina-feature`, `lamina-optimize`), **or**
- Direct mode: focused answer from the matched capability

## Subagent hints

- Inherit hints from the dispatched workflow
- Direct mode: inline only
