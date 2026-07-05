# Lamina Artifacts

**Guardrail:** Do not implement product code; generate UX artifacts only.

Always preserve `.lamina/` outputs between runs and reuse existing artifacts before regenerating.

Personas are **simulated users**, not static documents. Each persona runs as an **isolated subagent** (one agent per persona, parallel). Never inline multiple personas in one agent.

Load [capabilities/user-modeling.md](capabilities/user-modeling.md) for cast rubrics and simulation protocol.

---

## Persona artifacts

| Path | Purpose |
|---|---|
| `.lamina/personas.yaml` | Persona registry — goals, frustrations, literacy, accessibility. Cast appends; no fixed count. |
| `.lamina/personas/simulations/<run_id>.yaml` | One file per persona panel run. Keeps registry reads small. |

**Reuse rules:**
- Read `personas.yaml` before casting; append new personas rather than replacing.
- Never overwrite simulation files; each run gets a new `run_id`.
- Reconciliation output goes in command deliverables, not a separate artifact file.

### Registry — `.lamina/personas.yaml`

Cast-only. Append personas anytime; no fixed count.

```yaml
primary: deal-hunter-diane
personas:
  - id: deal-hunter-diane
    type: primary          # primary | secondary | supplemental | negative
    goals:
      experience: ["feel smart, not duped"]
      end: ["stretch the household budget", "complete purchase quickly"]
      life: []
    frustrations: ["hidden fees", "unclear shipping costs"]
    motivations: ["save money", "avoid regret purchases"]
    technical_literacy: novice   # novice | intermediate | expert
    accessibility:
      needs: []
      assistive_tech: []
    confidence: medium           # high | medium | low — low when provisional
```

**Required fields per persona:** `id`, `type`, `goals`, `frustrations`, `motivations`, `technical_literacy`, `accessibility`, `confidence`

### Per run — `.lamina/personas/simulations/<run_id>.yaml`

One file per panel execution. `run_id` = short slug (e.g. `checkout-optimize-2026-07-05`).

```yaml
hook: optimize              # ideate | optimize | feature
target: checkout flow
panel: [deal-hunter-diane, screen-reader-sam]
results:
  - persona_id: deal-hunter-diane
    outcome: partial_fail    # success | partial_fail | abandon
    blockers:
      - step: "Shipping options"
        severity: high       # high | medium | low
        quote: "Where's the free shipping threshold?"
  - persona_id: screen-reader-sam
    outcome: partial_fail
    blockers:
      - step: "Shipping options"
        severity: high
        quote: "The radio group isn't announced when focus moves here."
confidence: medium           # simulation — not user research
```

---

## Cast

**When:** Ideate step 1, or when adding personas to an existing product.

**How:**
1. Read existing `.lamina/personas.yaml` if present; append new personas, don't overwrite without consent.
2. Group by behavioral variables (not demographics alone); synthesize goals from evidence.
3. Designate exactly one `primary` persona per interface.
4. Write or update `.lamina/personas.yaml`.

**Pass:** Each persona has distinct goals and frustrations; primary designated.

---

## Simulate (persona panel)

**When:** A concrete flow, screen set, or journey exists to evaluate.

**Who runs:** Orchestrator picks relevant personas (always include primary). User may override with explicit ids. One subagent per picked persona.

**How:**
1. Read `.lamina/personas.yaml`.
2. Spawn **one isolated subagent per persona**, in parallel.
3. Write results to `.lamina/personas/simulations/<run_id>.yaml`.
4. Reconcile inline via `decision-making` — see [orchestration.md](orchestration.md) Persona panel.

### Subagent spawn template

Use the host tool's task/subagent mechanism. One task per persona.

```
readonly: true

Load only:
- capabilities/user-modeling.md (Persona simulation section)

Input:
- Single persona entry from personas.yaml
- Situational context for this run (scenario, device, time_pressure, stakes)
- Target artifact (flow, screens, or journey being evaluated)

Task:
Walk through the target step-by-step as this person. Think aloud in character.
Return a compact YAML results fragment:

persona_id: <id>
outcome: success | partial_fail | abandon
blockers:
  - step: "<step name>"
    severity: high | medium | low
    quote: "<in-character think-aloud>"

Constraints:
- Stay in character; no designer or heuristic vocabulary
- Do not prescribe solutions — describe confusion, frustration, abandonment
- Do not see other personas' outputs or expert audit findings
- Label output as simulation, not user research
```

---

## Reconcile

Orchestrator responsibility (main thread, not a subagent):

1. Collect all `results[]` from the run file.
2. **Consensus** — 2+ personas flag same step/issue → note as finding (still simulation).
3. **Conflict** — primary vs others → apply primary-user filter from `decision-making`.
4. **Unresolved** — use conflict record template from [orchestration.md](orchestration.md).
5. Surface **Conflicts resolved** in command output. Never average opinions.

---

## Evaluation hooks

| Hook | Command | Action |
|---|---|---|
| Cast | `/lamina-ideate` step 1 | Write `personas.yaml` |
| Walkthrough | `/lamina-ideate` step 4 | Persona panel on draft flows |
| Audit | `/lamina-optimize` | Persona panel per flow (parallel with expert lenses) |
| Feature review | `/lamina-feature` after flows | Persona panel; conflicts → risks |
| Test tasks | `/lamina-ideate` step 9 | Map simulation blockers → real usability test tasks |

Skip panel when nothing concrete to evaluate, or user wants a quick take.

---

## Other artifacts (planned)

| Path | Purpose |
|---|---|
| `.lamina/insights.md` | Synthesized UX insights |
| `.lamina/requirements.md` | UX requirements + handoff block |
| `.lamina/implementation-tasks.md` | P0/P1/P2 tasks for coding agents |
| `.lamina/edge-cases.md` | Edge case inventory |
| `.lamina/decisions.md` | Decision log |

---

## Checkpoints

Mandatory human gates (when running guided flows):
1. Problem framing — "Is this accurate?"
2. Synthesis validation — "Accurate enough to generate tasks?"
3. Task commit — write to `implementation-tasks.md`?
