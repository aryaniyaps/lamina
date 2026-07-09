# Persona panel (actor simulation)

**When:** Post-build `/lamina-verify` — or brownfield audit when a live product and personas exist. Not pre-build empathy theater.

**What:** **Simulated actor walks** — one dynamically spawned subagent per persona, all in parallel. Each subagent embodies that actor's goals, permissions, and constraints from `personas.yaml` / `run.yaml`. Never inline multiple personas in one agent.

**How to spawn:** For each panel member, build a unique prompt from `prompts/subagents/persona-panel-spawn.md` using that persona's full registry entry. Use the host Task/subagent tool — one parallel task per persona, `readonly: true`.

**Default panel:** `primary` + up to 2 other relevant personas unless the user requests more.

**Skip when:** No runnable product (`base_url` or local deploy), or design-only pass before `ready_to_build`.

**Visual grounding (existing product screens):** When `screens[].status: existing` and a product `base_url` is available, run [visual-walkthrough](visual-walkthrough.md) **before** spawning personas:

1. Capture live app once per flow (`walkthrough-capturer` prompt).
2. Apply capability ladder: multimodal PNG attachments → `screen-describer` → a11y-only → text fallback.
3. Spawn personas with visual evidence from the pack — never blueprint/Studio wireframes.

**Mixed flows:** Existing screens use walkthrough evidence; `new` screens use contract text until built, then re-verify on live UI.

**With parallel review:** In verify, visual walkthrough runs first; then persona panel and [expert lens review](../../lamina-heuristic-review/SKILL.md) run as separate parallel groups on the same flow target.

**Output:** Structured actor-walk YAML per persona → merged into `findings[]` via [research-synthesis](../../lamina-research-synthesis/SKILL.md).

Load [artifacts.md](../artifacts.md) for YAML shapes and reconcile protocol.
