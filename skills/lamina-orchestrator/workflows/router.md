# /lamina router workflow

Parse the user message for intent signals. Route (first strong match wins):

| Signal | Dispatch |
|---|---|
| Problem only, no solution, early exploration | [ideate.md](ideate.md) |
| Specific feature or capability to add | [feature.md](feature.md) |
| Improve, audit, review, optimize existing UI or flows | [optimize.md](optimize.md) |
| Single clear topic (forms, personas, interviews, navigation, etc.) | **Direct mode** — [lamina-core](../../lamina-core/SKILL.md) Problem Router → one skill |
| Ambiguous | Ask **one** question only: *"Are you (1) exploring a problem, (2) specifying a feature, or (3) improving something that exists?"* Then dispatch |

Execute the chosen path through completion. Do not implement product code. UX guidance only.

**Direct mode:** inline only (no subagents).

**Workflow mode:** inherit subagent hints from the dispatched workflow.
