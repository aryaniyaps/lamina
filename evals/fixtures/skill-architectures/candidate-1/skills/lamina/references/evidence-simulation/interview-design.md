# interview design

> Migrated intact from `skills/lamina-interview-design/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Actor-Walk Script Design (agent-native)

Design **what each simulated actor attempts** on the live product during verify.

## Script template

Per actor:
- **Goal** — outcome from persona (e.g. download ticket before exam)
- **Starting context** — role, permissions, data state
- **Happy path** — operations in order
- **Stress probes** — forbidden actions, race timing, error recovery
- **Success criteria** — observable UI/state + invariant holds

Spawn via persona-panel pattern; one subagent per actor.

## Anti-patterns

- **Open-ended interview** — "tell me how you feel" without operations
- **Leading questions** — scripting answers instead of observing behavior

## Related

- User Modeling
- Persona Panel
