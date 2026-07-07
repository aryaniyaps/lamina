# /lamina router workflow

Parse the user message for intent signals. Route (first strong match wins):

| Signal | Dispatch |
|---|---|
| Problem only, no solution, early exploration | [design.md](design.md) → concept track |
| Specific feature or capability to add | [design.md](design.md) → feature track |
| Improve, audit, review existing UI or flows | [audit.md](audit.md) |
| Single clear topic (forms, personas, interviews, navigation, etc.) | **Direct mode** — [lamina-core](../../lamina-core/SKILL.md) Problem Router → one skill |
| Ambiguous | Ask **one** question only: *"Are you (1) designing a whole product from a problem, (2) specifying one feature, or (3) improving something that exists?"* Then dispatch |

**Before dispatching** to design or audit: run [init-required](../prerequisites/init-required.md). On failure, emit `outputs/init-blocked` and **STOP** — do not dispatch. Direct mode is unaffected.

Execute the chosen path through completion. Do not implement product code. UX guidance only.

**Direct mode:** inline only (no subagents).

**Workflow mode:** inherit subagent hints from the dispatched workflow.
