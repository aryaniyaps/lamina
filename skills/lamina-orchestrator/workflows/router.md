# /lamina router workflow

Parse the user message for intent signals. Route (first strong match wins):

| Signal | Dispatch |
|---|---|
| Problem only, no solution, early exploration | [design.md](design.md) |
| Specific feature or capability to add | [design.md](design.md) |
| Improve, audit, review, **redesign**, or fix **existing** UI or flows | [audit.md](audit.md) |
| Single clear topic (forms, personas, interviews, navigation, etc.) | **Direct mode** — [lamina-core](../../lamina-core/SKILL.md) Problem Router → one skill |
| Ambiguous | Ask **one** question only: *"Are you designing new UX, improving something that already exists, or asking one focused UX question?"* Then dispatch |

**Audit vs design (critical):**

| User says | Route |
|---|---|
| "Redesign our checkout", "improve existing onboarding", "fix settings page", "higher conversion on checkout" | **audit** — improving something that exists |
| "We don't know what to build", "problem only", greenfield product idea | **design** |
| "Add notifications feature", "spec checkout flow" (net-new capability) | **design** |

**Redesign ≠ greenfield.** "Redesign X from scratch" still means audit the existing X flow — not net-new design.

**Before dispatching** to design or audit: run [init-required](../prerequisites/init-required.md). On failure, emit the `init-blocked` contract **verbatim** from `outputs/init-blocked.md` and **STOP** — do not dispatch, do not create artifacts, do not paraphrase the block. Direct mode is unaffected.

**Direct mode (mandatory):**
1. Match one row in the Problem Router table in [lamina-core](../../lamina-core/SKILL.md).
2. **Read** the matched `lamina-<id>/SKILL.md` before answering.
3. Apply that skill's frameworks in the response. Mention the skill id (e.g. `lamina-forms`) in the opening line.

Execute the chosen path through completion. Do not edit files outside `.lamina/`. UX guidance and `.lamina/` artifacts only. If the user asks `/lamina` to implement, fix, refactor, style, test, or configure app source, refuse that part briefly. **STOP** after delivering the output contract — implementation is a separate session.

**Direct mode:** inline only (no subagents).

**Workflow mode:** inherit subagent hints from the dispatched workflow.
