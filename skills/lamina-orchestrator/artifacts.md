# Lamina Artifacts

**Guardrail:** Do not implement product code; generate UX artifacts only.

Always preserve `.lamina/` outputs between runs and reuse existing artifacts before regenerating.

Personas are **simulated users**, not static documents. Each persona runs as an **isolated subagent** (one agent per persona, parallel). Never inline multiple personas in one agent.

Load [lamina-user-modeling](../lamina-user-modeling/SKILL.md) for cast rubrics.

Persona panel spawns are **dynamic** — one subagent per persona, each prompt embedding that persona's identity. See `prompts/subagents/persona-panel-spawn.md`.

---

## Runs (per command)

Each `/lamina-design` or `/lamina-audit` command creates a run workspace at `.lamina/runs/<run_id>/`.

**`run_id` convention:** short slug + date, e.g. `wishlist-feature-2026-07-08`, `checkout-audit-2026-07-08`.

| Path | When written | Purpose |
|---|---|---|
| `.lamina/runs/<run_id>/meta.yaml` | Command start | Run identity, hook, target, traceability |
| `.lamina/runs/<run_id>/output.md` | Command end | Full merged output contract (audit, concept, or feature) |
| `.lamina/runs/<run_id>/simulation.yaml` | Persona panel | Walkthrough outcomes (`results[]`, blockers) |
| `.lamina/runs/<run_id>/requirements.md` | Feature track, blueprint approve | UX requirements + handoff block |
| `.lamina/runs/<run_id>/implementation-tasks.md` | Feature track, implementation checklist | P0/P1/P2 coding-agent tasks |
| `.lamina/runs/<run_id>/personas-snapshot.yaml` | Optional — cast/refreshed in-run | Frozen copy of registry at panel time |

**Reuse rules:**
- Never overwrite an existing run directory; each command gets a new `run_id`.
- Write `meta.yaml` before other run artifacts.
- Write `output.md` at command end with the merged output contract.
- On conflict resolution, append to global `decisions.md` with `run_id` reference.

### Run metadata — `meta.yaml`

```yaml
id: wishlist-feature-2026-07-08
hook: feature          # concept | feature | audit
target: wishlist flow
command: /lamina-design
blueprint_id: wishlist-v1   # optional — link to evaluation artifact
flows_touched: [wishlist]   # flows appended/updated this run
personas_updated: false     # true when this run cast/refreshed personas.yaml
personas_snapshot: personas-snapshot.yaml  # optional — only when personas_updated
started_at: 2026-07-08
```

### Run output — `output.md`

Persisted copy of the merged output contract (`prompts/outputs/audit.md`, `design-concept.md`, or `design-feature.md`). Chat may summarize or point to this file.

`simulation.yaml` holds raw panel data; `output.md` holds reconciled **Persona simulation notes** and all other sections.

### Per-run simulation — `simulation.yaml`

One file per persona panel execution in the active run.

```yaml
hook: audit              # concept | audit | feature
target: checkout flow
panel: [deal-hunter-diane, screen-reader-sam]
results:
  - persona_id: deal-hunter-diane
    outcome: partial_fail    # success | partial_fail | abandon
    blockers:
      - step: "Shipping options"
        severity: high       # high | medium | low
        quote: "Where's the free shipping threshold?"
confidence: medium           # simulation — not user research
```

---

## Persona artifacts

Persona **identity** (who) and **simulation outcomes** (what happened) are separate layers.

| Path | Layer | Scope |
|---|---|---|
| `.lamina/personas.yaml` | Identity — goals, frustrations, literacy, accessibility | **Global** — stable product cast |
| `.lamina/runs/<run_id>/simulation.yaml` | Outcomes — walkthrough blockers and quotes | **Per run** |
| `.lamina/runs/<run_id>/personas-snapshot.yaml` | Identity snapshot when cast changed in-run | **Optional per run** |

**Reuse rules:**
- Read `personas.yaml` before casting; append new personas rather than replacing.
- Do not copy full personas into every run — identity lives in the global registry.
- When a run modifies the cast, set `meta.personas_updated: true` and optionally write `personas-snapshot.yaml`.
- Situational context (scenario, device, stakes) stays in spawn prompts only — not persisted.

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

---

## Cast

**When:** Ideate step 1, or when adding personas to an existing product.

**How:**
1. Read existing `.lamina/personas.yaml` if present; append new personas, don't overwrite without consent.
2. Group by behavioral variables (not demographics alone); synthesize goals from evidence.
3. Designate exactly one `primary` persona per interface.
4. Write or update `.lamina/personas.yaml`.
5. Set `meta.personas_updated: true` on the active run; optionally write `personas-snapshot.yaml`.

---

## Simulate (persona panel)

**When:** A concrete flow, screen set, or journey exists to evaluate.

**Who runs:** Orchestrator picks relevant personas (always include primary). User may override with explicit ids.

**How:**
1. Read `.lamina/personas.yaml` for identity.
2. For each panel persona, spawn one isolated subagent in parallel — build the prompt from `prompts/subagents/persona-panel-spawn.md` so the subagent **is** that person (not a generic simulator).
3. Write results to `.lamina/runs/<run_id>/simulation.yaml`.
4. Reconcile into `output.md` — see [patterns/persona-panel.md](patterns/persona-panel.md) and [merge-rules.md](merge-rules.md).

---

## Reconcile

Orchestrator responsibility (main thread, not a subagent):

1. Collect all `results[]` from the run's `simulation.yaml`.
2. **Consensus** — 2+ personas flag same step/issue → note as finding (still simulation).
3. **Conflict** — primary vs others → apply primary-user filter from `lamina-decision-making`.
4. **Unresolved** — use conflict record template from [merge-rules.md](merge-rules.md); append to global `decisions.md` with `run_id`.
5. Surface **Conflicts resolved** in `output.md`. Never average opinions.

---

## Evaluation hooks

| Hook | Command | Action |
|---|---|---|
| Bootstrap | `/lamina-init` | Write `business-context.md` |
| Cast | `/lamina-design` concept track step 1 | Write `personas.yaml`; set `personas_updated` on run |
| Walkthrough | `/lamina-design` concept track step 4 | Persona panel on draft flows |
| Audit | `/lamina-audit` | Persona panel per flow (parallel with expert lenses) |
| Feature review | `/lamina-design` feature track after flows | Persona panel; conflicts → risks |
| Test tasks | `/lamina-design` concept track step 9 | Map simulation blockers → real usability test tasks |

---

## Business context (init)

| Path | Purpose |
|---|---|
| `.lamina/business-context.md` | Business foundation for UX work — problem, goals, metrics, scope, users, constraints. **Only artifact `/lamina-init` creates.** |

Load [lamina-business-context](../lamina-business-context/SKILL.md) for question bank, skill mapping, and establish/update protocols.

### Prerequisite for downstream workflows

`/lamina-design`, `/lamina-audit`, and `/lamina` (when routing to those workflows) **require** a valid `business-context.md` from `/lamina-init`. See [init-required](prerequisites/init-required.md).

**Does not satisfy init:** `.lamina/personas.yaml`, `flows-inventory.yaml`, `blueprints/`, `preview-state.yaml`, or any other downstream artifact — presence of `.lamina/` alone is insufficient.

### Establish (`/lamina-init`)

**When:** First-time project bootstrap; explicit only (no auto-init from `/lamina`).

**How:**
1. Resolve business sections via user input and optional brownfield repo/doc scan.
2. Write `.lamina/business-context.md` with optional YAML frontmatter (`maturity`, `platform`, `last_updated`).
3. Recommend next command in init output only — do not persist.

**Does not create:** `config.yaml`, `insights.md`, `personas.yaml`, `flows-inventory.yaml`, or empty stubs.

### Update (`/lamina-init update`)

**When:** Business use case changed — pivot, new market, scope shift.

**How:**
1. Read existing `business-context.md` and changelog.
2. Re-apply skills for changed sections only; merge — preserve unchanged sections.
3. Append changelog entry (date, changed sections, trigger, stale downstream artifacts).
4. Never silently overwrite `personas.yaml` or `decisions.md` — flag staleness instead.
5. Conflicts with `decisions.md` → load `lamina-decision-making`.

### Section format

Each business section includes: **Answer**, **Confidence** (`high` | `medium` | `low`), **Evidence** (user input | `@path` | `assumption — needs validation`), **Skill** (capability that informed it).

Brownfield only: optional **Inferred context** section — product signals from README/docs/code with `@path` cites.

### Changelog (append-only footer)

```markdown
## Changelog
### 2026-07-06 — pivot to B2B
- Changed: scope, users & market, success metrics
- Trigger: user stated enterprise pivot
- Stale: re-run `/lamina-design` concept track step 1 if personas exist
```

---

## Flows inventory (downstream)

| Path | Purpose |
|---|---|
| `.lamina/flows-inventory.yaml` | User-facing flows accumulated as UX work progresses — **not created by init**. |

| Command | When to write / append |
|---|---|
| `/lamina-audit` | After auditing each flow — `status: shipped` |
| `/lamina-design` concept track step 4 | When draft flows are defined — `status: draft` |
| `/lamina-design` feature track | When feature flows are specified — `status: planned` |

Read before writing; append or update entries — never replace the whole file without consent. Record touched flow ids in `meta.flows_touched`.

```yaml
flows:
  - id: checkout
    name: Checkout
    routes: ["/cart", "/checkout"]
    status: shipped          # shipped | draft | planned | unknown
    priority: high           # high | medium | low
    evidence: ["app/checkout/page.tsx"]
```

---

## UX blueprints (optional)

| Path | Purpose |
|---|---|
| `.lamina/blueprints/<id>/` | Disposable semantic wireframe spec (TSX) — one per feature effort |
| `.lamina/preview-state.yaml` | Running preview server state (`url`, `port`, `pid`, `id`) — written by `preview --ensure` |

Load [lamina-blueprint](../lamina-blueprint/SKILL.md) for generation rules and preview CLI.

**Layout per blueprint:**

```
.lamina/blueprints/<id>/
  meta.yaml              # id, title, status: draft | approved
  structure-manifest.yaml  # optional — existing-screen checklist (subset of screens OK)
  flows.tsx
  screens/<screen-id>.tsx
  flows/<flow-id>/screens/   # alternate / optimized flow overrides
  scenarios.yaml             # structured edge-case inventory (see lamina-edge-cases)
  scenarios/<id>/screens/    # screen variants per scenario
```

`structure-manifest.yaml` lists **existing** screens only (with `source` + `elements`). New screens in the same blueprint have no manifest row. Validate enforces fidelity for listed screens; unlisted screens use standard checks only.

Optimize blueprints target **entire flows**. When evidence exists, write manifest for shipped screens before hydration. Update `screens/` for the new design, or add an alternate `<Flow id>` with `flows/<id>/screens/` overrides (no manifest row for overrides). Edge-case UI variants use `scenarios.yaml` branches on the flow graph.

**Lifecycle:** `draft` → `approved` → deleted on retire after implementation. Durable artifacts per run (`requirements.md`, `implementation-tasks.md`, `output.md`) and `flows-inventory.yaml` survive retirement.

**Multiple blueprints:** never overwrite another id's directory. Screen ids sync with `flows-inventory.yaml`. Link from run via `meta.blueprint_id`.

**Commands:** `lamina-blueprint preview --ensure --open`, `retire`, `validate` — see lamina-blueprint skill.

---

## Other artifacts (global)

| Path | Purpose | Owner |
|---|---|---|
| `.lamina/decisions.md` | Decision log — append with `run_id` on conflict | any workflow on conflict |

Create on first write — init does not create empty stubs.

---

## Checkpoints

Mandatory human gates (when running guided flows):
1. Problem framing — "Is this accurate?"
2. Synthesis validation — "Accurate enough to generate tasks?"
3. Task commit — write to `runs/<run_id>/implementation-tasks.md`?
