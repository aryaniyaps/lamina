# Persona panel (actor simulation)

**When:**

| Mode | Phase | Grounding |
|------|-------|-----------|
| **Design** | After scenarios/UX, before `ready_to_build` | Contract text — `workflows`, `screens`, `scenarios`, permissions |
| **Verify** | `/lamina-verify` | Live product when `base_url`; else static source + contract |

**What:** **Simulated actor walks** — one dynamically spawned subagent per persona, all in parallel. Each subagent embodies that actor's goals, permissions, and constraints from `personas.yaml` / `run.yaml`. Never inline multiple personas in one agent.

**How to spawn:** For each panel member, build a unique prompt from `prompts/subagents/persona-panel-spawn.md` using that persona's full registry entry. Use the host Task/subagent tool — one parallel task per persona, `readonly: true`. Set `mode: design` or `mode: verify` in the spawn prompt.

**Default panel:** `primary` + up to 2 other relevant personas unless the user requests more.

**Skip when:** Never skip for greenfield design — contract simulation is how missing flows are caught before build. For verify, do not skip solely because `base_url` is missing; fall back to static source + contract.

**Visual grounding (verify, existing product screens):** When `screens[].status: existing` and a product `base_url` is available, run [visual-walkthrough](visual-walkthrough.md) **before** spawning personas:

1. Capture live app once per flow (`walkthrough-capturer` prompt).
2. Apply capability ladder: multimodal PNG attachments → `screen-describer` → a11y-only → text fallback.
3. Spawn personas with visual evidence from the pack — never blueprint/Studio wireframes.

**Design mode:** No walkthrough. Paste workflow steps, screen ids, scenario triggers/acceptance, permission matrix, **and every `domain.dependencies[]` edge in unmet state** into each spawn. Personas must attempt the `from` workflow when the dependency is unmet and report whether `mode` + scenario `acceptance` hold. Also flag forbidden-content surfaces if advice/guidance appears. Personas report blockers and missing steps; orchestrator folds them into `scenarios[]` / `screens[]` / dependency modes with `acceptance`.

**Mixed flows (verify):** Existing screens use walkthrough evidence; `new` screens use contract text until built, then re-verify on live UI. Verify mode must re-probe unmet dependency edges and client-bypassable permission filters.

**With parallel review:** In verify, visual walkthrough (if any) runs first; then persona panel and [expert lens review](../../lamina-heuristic-review/SKILL.md) run as separate parallel groups on the same flow target.

**Output:** Structured actor-walk YAML per persona → merged into contract gaps (design) or `findings[]` (verify) via [research-synthesis](../../lamina-research-synthesis/SKILL.md).

Load [artifacts.md](../artifacts.md) for YAML shapes and reconcile protocol.
