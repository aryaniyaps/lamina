# Lamina Artifacts

**Guardrail:** Do not edit files outside `.lamina/`; generate UX artifacts only.

Always preserve `.lamina/` outputs between runs and reuse existing artifacts before regenerating.

Personas are **simulated users**, not static documents. Each persona runs as an **isolated subagent** (one agent per persona, parallel). Never inline multiple personas in one agent.

Load [lamina-user-modeling](../lamina-user-modeling/SKILL.md) for cast rubrics.

Persona panel spawns are **dynamic** — one subagent per persona, each prompt embedding that persona's identity. See `prompts/subagents/persona-panel-spawn.md`.

---

## Artifact model

### Global (4)

| Path | Purpose | Format |
|------|---------|--------|
| `.lamina/business-context.md` | Business foundation from `/lamina-init` | Markdown |
| `.lamina/personas.yaml` | Product cast — identity only | YAML |
| `.lamina/decisions.md` | Conflict resolution log with `run_id` refs | Markdown |
| `.lamina/preview-state.yaml` | UX Review Studio server URL/port/pid | YAML (runtime) |

### Per-run

| Path | Purpose | Format |
|------|---------|--------|
| `.lamina/runs/<run_id>/run.yaml` | **Single machine-parsable run record** | YAML |
| `.lamina/runs/<run_id>/report.md` | **Human narrative only** | Markdown |
| `.lamina/runs/<run_id>/artifacts/*.md` | Diagram-backed UX research/design artifact packs | Markdown + Mermaid |
| `.lamina/runs/<run_id>/handoff.md` | Final developer handoff for a separate coding session | Markdown + Mermaid |
| `.lamina/runs/<run_id>/evidence.md` | Optional evidence ledger for sources used by artifact packs | Markdown |
| `.lamina/runs/<run_id>/diagrams/*.mmd` | Optional reusable Mermaid diagrams | Mermaid |

### Optional disposable (1 directory)

| Path | Purpose | Format |
|------|---------|--------|
| `.lamina/blueprints/<id>/` | Wireframe spec + Screens view in UX Review Studio | TSX + `meta.yaml` + optional scenario variant TSX |

**Removed / deprecated:** `flows-inventory.yaml`, `output.md`, `structure-manifest.yaml`, `blueprints/<id>/scenarios.yaml` (scenarios live in `run.yaml`; blueprint holds variant TSX only).

---

## Runs (per command)

Each `/lamina-design` or `/lamina-audit` command creates a run workspace at `.lamina/runs/<run_id>/` with structured machine state, narrative, artifact packs, and a final handoff:

| Path | When written | Purpose |
|---|---|---|
| `.lamina/runs/<run_id>/run.yaml` | Command start; updated incrementally | Machine-readable: identity, flows, screens, scenarios, checklist/findings, simulation |
| `.lamina/runs/<run_id>/report.md` | Command end | Human narrative: journey, rationale, open questions, summaries |
| `.lamina/runs/<run_id>/artifacts/*.md` | After relevant workflow sections | Human-reviewable UX artifacts with diagrams, evidence, confidence, and gaps |
| `.lamina/runs/<run_id>/handoff.md` | After checklist/findings and artifact packs | Developer handoff for a future coding session |
| `.lamina/runs/<run_id>/evidence.md` | As sources are synthesized | Evidence ledger for research, repo references, simulation, assumptions, and source paths |

**`run_id` convention:** short slug + date, e.g. `wishlist-feature-2026-07-08`, `checkout-audit-2026-07-08`.

**Reuse rules:**
- Never overwrite an existing run directory; each command gets a new `run_id`.
- Write `run.yaml` at command start; update structured sections as each workflow step completes.
- Write `report.md` once at command end with narrative only.
- Write artifact packs only under the current run's `artifacts/` directory; do not write UX artifacts outside `.lamina/`.
- Write `handoff.md` only after `run.yaml` has checklist or findings.
- On conflict resolution, append to global `decisions.md` with `run_id` reference.

**Write lifecycle:**
1. Command start → create `run.yaml` with identity fields
2. After cast updates → set `personas_updated: true` in `run.yaml`
3. After flows defined → write `flows[]` and `screens[]` to `run.yaml`
4. After edge cases → write `scenarios[]` to `run.yaml`
5. After persona panel → add `simulation` block to `run.yaml`
6. Design handoff → write `checklist[]` to `run.yaml` when implementation tasks are clear
7. Audit track → write `findings[]` to `run.yaml`
8. Artifact planning → load `artifact-catalog.yaml`; decide generate, plan/template, delegate, block, or skip
9. Artifact packs → write `artifacts/*.md`; add entries to `run.yaml` `artifacts[]`
10. After blueprint create/approve → set `blueprint_id` in `run.yaml`; set `run_id` in blueprint `meta.yaml`
11. Handoff → write `handoff.md`; add it to `run.yaml` `artifacts[]`
12. Command end → write `report.md` (brief narrative and pointers only)

Validate structured output: `lamina-studio validate run .lamina/runs/<run_id>/run.yaml`

### Machine state — `run.yaml`

```yaml
id: wishlist-feature-2026-07-08
hook: design           # design | audit
target: wishlist flow
command: /lamina-design
blueprint_id: wishlist-v1   # optional — link to evaluation artifact
flows_touched: [wishlist]
personas_updated: false
started_at: 2026-07-08

evidence:
  - id: business-context
    source: .lamina/business-context.md
    kind: business_context
    summary: Budget-conscious shoppers need confidence before checkout
  - id: persona-panel
    source: run.yaml simulation
    kind: simulation
    summary: Primary persona hesitated at unclear shipping threshold

artifacts:
  - id: flow-pack
    type: user_flow
    pack: flow
    path: artifacts/flow-pack.md
    confidence: medium
    evidence_mode: run_yaml_required
    diagram: flowchart
  - id: developer-handoff
    type: developer_handoff
    pack: handoff
    path: handoff.md
    confidence: medium
    evidence_mode: run_yaml_required
    diagram: flowchart

flows:
  - id: wishlist
    name: Wishlist
    status: planned      # shipped | draft | planned | unknown
    routes: ["/wishlist"]
    priority: high
    evidence: []
    graphs:
      - id: main
        entry_screen: wishlist
        transitions:
          - trigger: add-item
            from: wishlist
            target: wishlist-detail

screens:
  - id: wishlist
    title: Wishlist
    status: new          # new | existing
    source: null         # @path when existing (brownfield fidelity) — read-only reference, never edit during Lamina commands
    regions: [main]
    elements:
      - component: Heading
        text: Your wishlist
        level: 1
      - component: Button
        label: Add item
        trigger: add-item

scenarios:
  - id: empty-wishlist
    title: No items saved
    screen: wishlist
    flow: main
    severity: medium
    category: empty
    trigger:
      operation: view wishlist
      subject: wishlist items
      when: collection_empty
    ux: empty_state

checklist:               # design handoff tasks for a future coding agent, not work done now
  - id: wishlist-empty-state
    priority: P0
    title: Add empty wishlist state
    acceptance:
      - EmptyState shown when no items
    screens: [wishlist]

findings:                # audit track only
  - id: shipping-threshold
    priority: high
    finding: Free shipping threshold not visible
    impact: high
    effort: low
    recommendation: Add banner on cart
    screen_id: cart
    flow_id: checkout

simulation:
  panel: [deal-hunter-diane]
  results:
    - persona_id: deal-hunter-diane
      outcome: partial_fail
      blockers:
        - step: Shipping options
          screen_id: shipping
          flow_id: checkout
          severity: high
          quote: "Where's the free shipping threshold?"
  confidence: medium
```

**Section presence by hook:**

| Section | design | audit |
|---------|--------|-------|
| `flows`, `screens` | yes | optional |
| `scenarios` | when concrete edge cases exist | optional |
| `checklist` | when handoff tasks are clear | — |
| `findings` | — | yes |
| `simulation` | when panel runs | when panel runs |
| `evidence` | when sources exist | when sources exist |
| `artifacts` | yes | yes |

### Human narrative — `report.md`

Persisted copy of the narrative output contract (`prompts/outputs/design.md` or `prompts/outputs/audit.md`). **Not** the source of truth for structure — agents read `run.yaml` for flows, screens, scenarios, checklist, and findings.

- `run.yaml` holds all machine-parsable data
- `report.md` holds journey, rationale, copy guidance (tone), open questions, reconciled persona summary
- `artifacts/*.md` holds rich UX deliverables with diagrams, evidence, confidence, and missing inputs
- `handoff.md` holds developer-ready implementation guidance for a separate coding session
- Brief pointers to `run.yaml`: e.g. *"3 flows, 8 screens — see `run.yaml`"*
- Design workflow: `### Blueprint handoff (<id>)` on approve
- Never embed authoritative flow graphs, edge-case tables, or checklist tables in `report.md`

### Diagram-backed artifact packs

Load `artifact-catalog.yaml` before generating artifacts.

**Artifact packs are not automatic dumps.** Generate only the packs relevant to the command and evidence:

- Research pack: research plan, brief, interview guide, observation notes, affinity diagram, empathy map, personas/proto-personas, archetypes, JTBD, insights, needs, segmentation, mental model, motivation matrix.
- IA pack: site map, navigation map, content inventory/audit/model, taxonomy, ontology, labeling, metadata, card sort/tree test summaries.
- Flow pack: user flows, task flows, screen flows, decision/edge/alternate/happy paths, use case/activity/state diagrams.
- Journey pack: customer/user journey, experience map, service blueprint, ecosystem/stakeholder maps, emotional journey, touchpoints/channels, timelines.
- Interaction pack: wireflows, interaction matrix, scenarios, event flow, state machine/table, decision tree.
- Validation pack: usability test plan/script/tasks, observation sheet, issue log, severity matrix, findings/SUS/benchmark reports.
- Accessibility pack: audit, contrast report, keyboard/focus order, screen reader flow, WCAG checklist.
- Strategy pack: opportunity solution tree, prioritization, Kano, value proposition, Lean UX canvas, product vision, roadmap, impact/story mapping.
- Handoff pack: design specification, component specs, motion specs, token docs, API interaction spec, implementation sequencing.

**Evidence gating:**

- Do not invent interview quotes, participants, analytics, usability results, SUS scores, heatmaps, click maps, scroll maps, benchmark data, or accessibility measurements.
- If evidence-required inputs are missing, write a plan/template artifact and mark confidence `blocked` or `low`.
- Label real research, repo evidence, assumptions, and persona simulation separately.
- Every generated artifact must cite sources and include at least one Mermaid diagram or a blocked-diagram explanation.

**Mermaid defaults:** `flowchart`, `journey`, `timeline`, `stateDiagram-v2`, `sequenceDiagram`, `classDiagram`, `quadrantChart`, `mindmap`, or swimlane-style `flowchart` with subgraphs. Do not use custom Mermaid styling.

---

## Persona artifacts

Persona **identity** (who) and **simulation outcomes** (what happened) are separate layers.

| Path | Layer | Scope |
|---|---|---|
| `.lamina/personas.yaml` | Identity — goals, frustrations, literacy, accessibility | **Global** — stable product cast |
| `.lamina/runs/<run_id>/run.yaml` `simulation` | Outcomes — walkthrough blockers and quotes | **Per run** |

**Reuse rules:**
- Read `personas.yaml` before casting; append new personas rather than replacing.
- Do not copy full personas into every run — identity lives in the global registry.
- When a run modifies the cast, set `personas_updated: true` in `run.yaml`.
- Situational context (scenario, device, stakes) stays in spawn prompts only — not persisted.

### Registry — `.lamina/personas.yaml`

Cast-only. Append personas anytime; no fixed count.

```yaml
primary: deal-hunter-diane
personas:
  - id: deal-hunter-diane
    type: primary
    goals:
      experience: ["feel smart, not duped"]
      end: ["stretch the household budget", "complete purchase quickly"]
      life: []
    frustrations: ["hidden fees", "unclear shipping costs"]
    motivations: ["save money", "avoid regret purchases"]
    technical_literacy: novice
    accessibility:
      needs: []
      assistive_tech: []
    confidence: medium
```

**Required fields per persona:** `id`, `type`, `goals`, `frustrations`, `motivations`, `technical_literacy`, `accessibility`, `confidence`

---

## Cast

**When:** The design workflow needs a missing or stale cast, or when adding personas to an existing product.

**How:**
1. Read existing `.lamina/personas.yaml` if present; append new personas, don't overwrite without consent.
2. Group by behavioral variables (not demographics alone); synthesize goals from evidence.
3. Designate exactly one `primary` persona per interface.
4. Write or update `.lamina/personas.yaml`.
5. Set `personas_updated: true` in `run.yaml`.

---

## Simulate (persona panel)

**When:** A concrete flow, screen set, or journey exists to evaluate.

**Who runs:** Orchestrator picks relevant personas (always include primary). User may override with explicit ids.

**How:**
1. Read `.lamina/personas.yaml` for identity.
2. For each panel persona, spawn one isolated subagent in parallel — build the prompt from `prompts/subagents/persona-panel-spawn.md`.
3. Add `simulation` block to `.lamina/runs/<run_id>/run.yaml` (include `screen_id` and `flow_id` on blockers when known).
4. Reconcile into `report.md` — see [patterns/persona-panel.md](patterns/persona-panel.md) and [merge-rules.md](merge-rules.md).

---

## Reconcile

Orchestrator responsibility (main thread, not a subagent):

1. Collect all `results[]` from `run.yaml` `simulation`.
2. **Consensus** — 2+ personas flag same step/issue → note as finding (still simulation).
3. **Conflict** — primary vs others → apply primary-user filter from `lamina-decision-making`.
4. **Unresolved** — use conflict record template from [merge-rules.md](merge-rules.md); append to global `decisions.md` with `run_id`.
5. Surface **Conflicts resolved** in `report.md`. Never average opinions.

---

## Cross-run flow discovery

There is no global `flows-inventory.yaml`. Agents discover flows by:

1. **Brownfield scan** — read production routes/components
2. **Prior runs** — read `.lamina/runs/*/run.yaml` for `flows_touched` and `flows[]` entries
3. **Current run** — authoritative for this command's scope

When audit marks a flow `status: shipped`, that status lives in the audit run's `run.yaml` `flows[]`.

---

## UX blueprints (optional)

| Path | Purpose |
|---|---|
| `.lamina/blueprints/<id>/` | Disposable semantic wireframe spec (TSX) — one per feature effort |
| `.lamina/preview-state.yaml` | Running UX Review Studio server state — written by `review --ensure` |

Load [lamina-studio](../lamina-studio/SKILL.md) for generation rules and studio CLI.

**Layout per blueprint:**

```
.lamina/blueprints/<id>/
  meta.yaml              # id, title, status, run_id (link to run.yaml scenarios)
  flows.tsx
  screens/<screen-id>.tsx
  flows/<flow-id>/screens/   # alternate flow overrides
  scenarios/<id>/screens/    # optional screen variants per scenario (inventory in run.yaml)
```

**Blueprint authoring:** Read `run.yaml` `flows`, `screens`, and `scenarios` — write TSX by hand. No codegen. Brownfield: `screens[].status: existing` + `source` + `elements` in `run.yaml` replaces `structure-manifest.yaml`.

**Lifecycle:** `draft` → `approved` → deleted on retire after implementation. Durable records: `run.yaml`, `report.md`.

**Multiple blueprints:** never overwrite another id's directory. Link from run via `run.yaml` `blueprint_id` and `meta.yaml` `run_id`.

**Commands:** `lamina-studio review --ensure --open`, `retire`, `validate`, `validate run` — see lamina-studio skill.

---

## Business context (init)

| Path | Purpose |
|---|---|
| `.lamina/business-context.md` | Business foundation for UX work |
| `.lamina/personas.yaml` | Product cast — written during `/lamina-init` establish |

Load [lamina-business-context](../lamina-business-context/SKILL.md) for question bank, skill mapping, and establish/update protocols.

### Prerequisite for downstream workflows

`/lamina-design`, `/lamina-audit`, and `/lamina` require valid `business-context.md` from `/lamina-init`. See [init-required](prerequisites/init-required.md).

**Does not satisfy init:** `.lamina/personas.yaml`, `blueprints/`, `preview-state.yaml`, or prior `run.yaml` files.

---

## Other artifacts (global)

| Path | Purpose | Owner |
|---|---|---|
| `.lamina/decisions.md` | Decision log — append with `run_id` on conflict | any workflow on conflict |

Create on first write — init does not create empty stubs.

---

## Evaluation hooks

| Hook | Command | Action |
|---|---|---|
| Bootstrap | `/lamina-init` establish | Write `business-context.md` and `personas.yaml` |
| Cast | `/lamina-design` | Append or refine `personas.yaml`; set `personas_updated` on run when cast changes |
| Walkthrough | `/lamina-design` | Persona panel; write `flows[]`/`screens[]` to `run.yaml` |
| Audit | `/lamina-audit` | Persona panel per flow; write `findings[]` to `run.yaml` |
| Edge-case review | `/lamina-design` | Persona panel; write `scenarios[]`, `checklist[]` to `run.yaml` when applicable |
| Test tasks | `/lamina-design` | Map simulation blockers → real usability test tasks |

---

## Checkpoints

Mandatory human gates (when running guided flows):
1. Problem framing — "Is this accurate?"
2. Synthesis validation — "Accurate enough to generate tasks?"
3. Task commit — write `checklist[]` to `run.yaml`?
