# Lamina Artifacts

**Guardrail:** Write only under `.lamina/`. Never edit app source.

Always preserve `.lamina/` outputs between runs and reuse existing artifacts before regenerating.

---

## Artifact model

### Global

| Path | Purpose |
|------|---------|
| `.lamina/business-context.md` | Domain charter from `/lamina-init` |
| `.lamina/personas.yaml` | Actors — roles, goals, permissions, constraints |
| `.lamina/decisions.md` | Conflict resolution log with `run_id` refs |

### Per-run (canonical paths only)

| Path | Purpose |
|------|---------|
| `.lamina/runs/<run_id>/run.yaml` | **Machine contract** — domain (incl. **dependencies graph**), actors, workflows, scenarios, screens, seed, scope, findings |
| `.lamina/runs/<run_id>/implement.md` | Ship pack at `ready_to_build` — [prompts/outputs/implement.md](prompts/outputs/implement.md) |
| `.lamina/runs/<run_id>/fix.md` | Post-verify product fix brief — always written after verify |
| `.lamina/runs/<run_id>/report.md` | Human narrative only (design or verify) |
| `.lamina/runs/<run_id>/walkthrough/` | Live-app evidence when `base_url` available |
| `.lamina/runs/<run_id>/evidence.md` | Optional evidence ledger |

**Do not write:** `handoff.md`, `verify-report.md`, blueprints, freestyle `edge_cases` / `illegal_states` / `preconditions` as substitutes for the machine schema, or ship packs outside `runs/<run_id>/`.

Validate: `node lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml` — **must pass** before `ready_to_build`.

---

## Run lifecycle

### Design (`/lamina-design`)

1. Create `run.yaml` — `status: designing`, `hook: design`
2. Write `domain.entities`, `domain.invariants`, **`domain.dependencies[]` (first-class)**, `actors` (+ `resource_filters`), `workflows` (+ `requires` / `standalone` / `provides`), `screens` (+ **`a11y`** on every `status: new`), `scenarios` (each with `acceptance`), `tradeoffs[]`, `out_of_scope`, `forbidden_content`, `seed`
3. **Contract simulation** — persona panel including **unmet-dependency walks**; fold gaps into scenarios/screens/**dependency modes**
4. **Validate** — `node lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml` must pass. On failure: stay `designing`; never invent alternate paths.
5. Set `status: ready_to_build` **only after** validation passes; write ship-pack `implement.md` with **Must-implement checklist**
6. Write `report.md`

**Completion gate:** Design is incomplete until (a) validator passes and (b) both `.lamina/runs/<run_id>/run.yaml` and `implement.md` exist. Never `.lamina/ready_to_build/`, `contract.md`, `verify-report.md`, or freestyle `edge_cases` / `preconditions` / `illegal_states`.

### Verify (`/lamina-verify`)

1. Load design run or infer domain
2. `status: verifying`
3. Live walkthrough or **static source** (never STOP for missing `base_url`)
4. **Reachability probes for every dependency edge** + actor walks → ticket-shaped `findings[]`
5. `status: complete` → `report.md` + **always** `fix.md` (omit `ops`)

---

## `run.yaml` schema (machine contract)

```yaml
id: hall-ticket-2026-07-09
status: designing | ready_to_build | verifying | complete
hook: design | verify
target: hall ticket download
command: /lamina-design
started_at: 2026-07-09

domain:
  entities:
    - id: payment
    - id: hall_ticket
      attributes: [owner_id]          # declare ownership fields used by filters
  invariants:
    - id: one-ticket-per-student
      rule: At most one valid hall ticket per student per exam
  dependencies:                         # FIRST-CLASS reachability graph
    - id: download-requires-payment
      from: workflow.download-ticket
      requires: entity.payment
      in_state: confirmed
      mode: unreachable               # unreachable | degraded | blocked_ui | recover
      scenario_ref: payment-not-confirmed

actors:
  - id: student
    permissions: [download_ticket]
    resource_filters:
      - resource: hall_ticket
        filter: "owner_id = self"
  - id: partner
    permissions: [read_transaction]
    resource_filters:
      - resource: transaction
        filter: "is_personal = false OR owner_id = self"

workflows:
  - id: pay-fees
    standalone: true
    provides: [entity.payment]
    steps:
      - operation: confirm payment
  - id: download-ticket
    requires: [download-requires-payment]
    success: "PDF downloaded"
    failure: "Blocked until payment confirmed"
    steps:
      - operation: download pdf

scenarios:
  - id: payment-not-confirmed
    title: Payment pending blocks download
    screen: ticket-download
    category: precondition
    ux: alert
    trigger:
      operation: download ticket
      subject: payment
      when: dependency_unmet
    dependency_ref: download-requires-payment
    acceptance: "UI shows payment-required alert; download control disabled; no PDF bytes"
    # optional structured hints:
    # http_status: 403
    # error_code: PAYMENT_REQUIRED

screens:
  - id: ticket-download
    status: new
    workflow_ref: download-ticket
    a11y:
      labels: every primary control has accessible name (aria-label or visible label)
      touch_min_px: 48
      color_not_only: true
      keyboard: primary path completable without pointer

tradeoffs:
  - id: clarity_vs_granularity          # stable snake_id — reuse brief/golden wording when present
    choice: Prefer clear weekly totals over per-merchant drill-down by default
    cost: Power users need an explicit expand / view-all path
    surfaces: [ticket-download]

out_of_scope:
  - CI/CD pipelines
  - Push notification vendors
  - Production bank OAuth unless brief requires

forbidden_content:
  - investment advice                   # must become a rejection / absent surface in product
  - tax advice presented as guidance

seed:
  summary: Student with unpaid fees; student with confirmed payment
  - unpaid student cannot download
  - paid student can download

findings: []   # verify tickets — see below

evidence: []
```

### `ready_to_build` gates (validator)

Must have: `scenarios[]` (with `acceptance`), `screens[]` (each `status: new` has `a11y` with `labels` + `touch_min_px`), **`domain.dependencies[]`**, `tradeoffs[]` (each with `id` + `choice`), `forbidden_content[]`, `out_of_scope[]`, `seed`, valid dependency graph (modes, scenario links, no orphans, no freestyle `edge_cases` / `preconditions` / `illegal_states`).

### Findings (verify tickets)

```yaml
findings:
  - id: partner-personal-tx-leak
    fix_target: product          # product | contract | ops — required
    priority: high
    summary: Partner can read personal transactions
    verify_mode: static_source   # static_source | live_app | mixed
    evidence: src/routes/transaction.ts GET list
    acceptance: "Partner list omits is_personal=true where owner_id!=self"
    scenario_ref: partner-cannot-see-personal-txn
    recommendation: Filter by resource_filters
```

`ops` findings stay in `report.md` only — never Product fixes in `fix.md`.

---

## `implement.md` (ship pack)

Projection of the machine contract for a coding session — [prompts/outputs/implement.md](prompts/outputs/implement.md).

Must include **Reachability graph**, invariants→enforcement, permissions **with filters**, workflows→surfaces, scenarios→acceptance (verbatim), **Must-implement checklist** (`scenario.*`, `forbidden.*`, `a11y.*`, `tradeoff.*`), seed notes, out of scope.

Not a vendor blueprint. **Forbidden content and a11y hooks are code requirements**, not narrative.

---

## `fix.md`

Always written after verify — [prompts/outputs/fix.md](prompts/outputs/fix.md). Mechanical projection of `findings[]` where `fix_target != ops`.

---

## Actor / persona simulation

Design-time: walk contract including **dependency modes** (what happens when unmet). Verify-time: live or static. Simulation must write holes back as dependency/scenario/screen ids — not more prose `handling`.

---

## Ops non-findings

Unless brief/`out_of_scope` says otherwise: CI/CD, deploy, push vendors, monitoring, production IdP scaffolding are `ops` or omitted — not product ship gates.
