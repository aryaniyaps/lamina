# /lamina router workflow

Parse the user message for intent signals. Route (first strong match wins):

| Signal | Dispatch |
|--------|----------|
| Problem only, no solution, early exploration | [design.md](design.md) |
| Specific feature or capability to add | [design.md](design.md) — mention **flows** and **edge cases** in the response |
| Implementation done, verify product | [verify.md](verify.md) |
| Improve, audit, review, fix, redesign, or reduce abandonment on **existing** UI or flows | [verify.md](verify.md) — mention **audit**, **findings**, or **prioritized** improvements; say **improving existing UX** (not greenfield) |
| Implement findings / apply `fix.md` from prior verify | **Not a Lamina command** — coding session reads `.lamina/runs/<id>/fix.md`; app source allowed outside Lamina |
| Single clear topic (forms, navigation, a11y, onboarding, errors, research, …) | **Direct mode** — [lamina-core](../../lamina-core/SKILL.md) → one skill; **no init gate**; cite `lamina-<id>` |
| Ambiguous | Ask: *"Design new behavior, verify existing product, or one focused question?"* |

**Verify vs design:**

| User says | Route |
|-----------|-------|
| "Redesign checkout", "audit settings", "fix flow", "implementation done" | **verify** |
| "Add hall ticket feature", "spec booking flow" | **design** |
| "We don't know what to build" | **design** (after init) |

**Before design or verify only:** run [init-required](../prerequisites/init-required.md). On failure → one-line **intended route** cue (design workflow / audit vocabulary from the router table), then `init-blocked` verbatim and **STOP**. Direct mode never runs this gate.

**Direct mode:** read matched `lamina-<id>/SKILL.md`; cite skill id in response.

Execute chosen path. Writes: `.lamina/` only. Never app source. After `ready_to_build`, user implements from `implement.md` then `/lamina-verify`. After verify, user implements from `fix.md` then re-runs `/lamina-verify`.
