# Persona panel

**When:** A concrete flow, screen set, or journey exists; personas in `.lamina/personas.yaml`.

**What:** Simulated user walkthroughs — one **dynamically spawned** subagent per persona, all in parallel. Each subagent's prompt makes them **that person** (not a generic simulator). Never inline multiple personas in one agent.

**How to spawn:** For each panel member, build a unique prompt from `prompts/subagents/persona-panel-spawn.md` using that persona's full registry entry. Use the host Task/subagent tool — one parallel task per persona, `readonly: true`.

**Default panel:** `primary` + up to 2 other relevant personas unless the user requests more.

**Skip when:** No evaluable artifact yet, or user wants a quick take.

**With parallel review:** In audit, persona panel and expert audit lenses run as separate parallel groups on the same flow target.

Load [artifacts.md](../artifacts.md) for YAML shapes and reconcile protocol.
