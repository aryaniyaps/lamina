---
name: lamina-blueprint
description: "Generate and maintain semantic UX blueprints (SUB) with optional greyscale wireframe preview. Use when visualizing and evaluating UX artifacts — flows, screens, scenarios, and persona walkthroughs."
metadata:
  lamina:
    id: blueprint
    problems:
      - "wireframe preview"
      - "screen structure"
      - "UX artifact evaluation"
      - "visualize flows and screens"
    related:
      - lamina-flow-design
      - lamina-product-behavior
      - lamina-requirements-definition
    tags:
      - artifacts
---
# Lamina Blueprint (SUB)

**Semantic UX blueprints** — TSX structure specs, not production code. Optional greyscale wireframe preview via local URL for **evaluating UX artifacts** — walk flows, compare scenarios, overlay persona blockers, assess structure before coding.

**Guardrail:** Blueprints describe **structure and behavior only**. No `className`, `style`, CSS, colors, typography, or design tokens in blueprint files. Preview uses a **dark greyscale** renderer — still not a styling spec.

## When to use

- Evaluate structure, flows, and edge-case scenarios during design or audit
- Walk interactive prototypes with hotspot navigation and flow graph
- Overlay persona simulation blockers on screens for usability assessment
- Handoff to coding agents after evaluation (approve is one outcome, not the primary purpose)

## Artifact layout

```
.lamina/blueprints/<id>/
  meta.yaml           # id, title, status, run_id (link to run.yaml scenarios)
  app.tsx             # optional root
  flows.tsx           # Transition edges
  screens/
    <screen-id>.tsx
  flows/
    <flow-id>/screens/  # optional per-flow overrides (alternate flows, optimize variants)
  scenarios/
    <scenario-id>/screens/<screen-id>.tsx  # screen variant (empty, error, etc.)
```

Read `run.yaml` `flows`, `screens`, and `scenarios` before authoring blueprint TSX. **No codegen** — write TSX by hand.

Each blueprint is **disposable** — delete after implementation. Durable record per run: `runs/<run_id>/run.yaml` and `report.md`.

**Multiple blueprints:** one directory per feature effort. Never overwrite another blueprint's files.

## Component vocabulary

Import only from `@lamina/blueprint`:

**Structure:** `Application`, `Screen`, `Flow`, `Page`, `Header`, `Footer`, `Main`, `Section`, `Sidebar`, `Row`, `Column`, `Stack`, `Grid`, `Tabs`, `SplitLayout`, `ScrollArea`, `Overlay`

**Navigation:** `Navigation`, `Breadcrumb`, `Menu`, `UserMenu`, `Pagination`, `Stepper`, `TabBar`, `Transition`

**Content:** `Heading`, `Text`, `Image`, `Avatar`, `Metric`, `Chart`, `Timeline`, `Badge`, `CodeBlock`, `Table`, `List`

**Forms:** `Field`, `Form`, `Search`, `TextArea`, `Select`, `Checkbox`, `Radio`, `Toggle`, `DatePicker`, `FileUpload`

**Actions:** `Button`, `Action`, `Link`, `Toolbar`, `ActionMenu` — use optional `trigger="..."` to wire interactive preview navigation

**Feedback:** `Loading`, `Alert`, `Toast`, `Banner`, `EmptyState`, `ErrorState`, `SuccessState`, `Progress`

**Fallback:** `Placeholder` with `as="CustomType"` for anything not listed

### Interactive triggers

Wire buttons to flow transitions for clickable prototype walkthrough:

```tsx
<Button label="Sign in" trigger="sign-in" />
<Action label="Continue" trigger="continue" />
<Link label="Skip" trigger="skip-intro" />
```

`trigger` must match a `<Transition trigger="..." from="current-screen-id" />` in `flows.tsx`.

### Multi-screen flow walkthrough (required)

When a flow has **two or more linked screens**, every screen that has **outgoing** transitions must include **at least one** interactive element (`Button`, `Action`, or `Link`) with a `trigger` that matches an outgoing transition from that screen.

- Put the trigger on the control that advances the flow (primary CTA, row action, nav link — not a passive label).
- Prefer one trigger per outgoing transition so every branch is clickable in the prototype.
- Preview highlights matching `[data-trigger]` elements as **hotspots** (pulse ring) for the active flow; clicking a hotspot navigates like clicking the flow graph.
- **Terminal screens** (no outgoing transitions) are exempt.
- Per-flow overrides (`flows/<flow-id>/screens/`) must still satisfy this for that flow’s transitions — a shared screen and a flow override can expose different triggers.

`lamina-blueprint validate` checks that every `trigger` on a screen has a matching transition **and** every outgoing transition has a matching `trigger` on the effective screen file.

### Edge-case scenarios (preview)

Map each edge case to a **screen variant** in the blueprint (not a separate navigation paradigm). Branch-style edge cases (different path) use a new `<Flow id>` and the flow picker.

Load [lamina-edge-cases](../lamina-edge-cases/SKILL.md) for systematic discovery via transient operation inventory and outcome matrix.

**Scenarios** — inventory lives in linked `run.yaml` `scenarios[]`. Preview reads via `meta.yaml` `run_id`. Blueprint holds variant TSX only.

```yaml
# run.yaml scenarios[] (required fields per entry):
  - id: empty-orders
    title: No orders yet
    screen: orders
    flow: main              # optional — omit to show in all flows
    description: User lands before any orders exist
    severity: medium        # high | medium | low
    category: empty         # empty | precondition | partial | conflict | failure | permission | external | boundary
    trigger:
      operation: view orders  # user-facing verb phrase — not an API path or DB table
      subject: orders         # data involved; loosely matches Table source
      when: collection_empty  # collection_empty | not_found | validation_failed | state_disallows | concurrent_edit | session_expired | forbidden | dependency_unavailable | limit_reached | timeout
    ux: empty_state           # empty_state | error_state | alert | banner | redirect | alternate_flow
```

**Variant file:** `scenarios/<scenario-id>/screens/<screen-id>.tsx` — use `EmptyState`, `ErrorState`, `Alert`, etc. per `ux` field.

When no blueprint exists yet, write edge cases to `run.yaml` `scenarios[]` during the feature track. Write scenario variant TSX at blueprint checkpoint.

Preview shows scenarios as **dashed branches** on the flow graph; click a branch node to load the variant; click the main screen node to return to the happy path.

### Screen example

```tsx
import { Screen, Page, Section, Heading, Form, Field, Button } from '@lamina/blueprint';

export default function LoginScreen() {
  return (
    <Screen id="login" title="Login">
      <Page>
        <Section>
          <Heading level={1}>Sign in</Heading>
          <Form>
            <Field name="email" label="Email" type="email" required />
            <Field name="password" label="Password" type="password" required />
            <Button label="Sign in" trigger="sign-in" />
          </Form>
        </Section>
      </Page>
    </Screen>
  );
}
```

### Flow example (`flows.tsx`)

```tsx
import { Flow, Transition } from '@lamina/blueprint';

export default function Flows() {
  return (
    <Flow id="checkout">
      <Transition trigger="sign-in" target="dashboard" from="login" />
      <Transition trigger="view-orders" target="orders" from="dashboard" />
    </Flow>
  );
}
```

Optional `<Flow id="...">` groups transitions when multiple flows exist. Per-flow screen overrides live at `flows/<flow-id>/screens/<screen>.tsx` and fall back to `screens/<screen>.tsx`. Preview shows a flow graph on the right; pick a flow, click nodes, or click highlighted hotspot triggers (`data-trigger`) to navigate the active flow.

Screen `id` values must match `run.yaml` `screens[]` ids.

## Preview CLI

```bash
lamina-blueprint preview --root .lamina/blueprints --id <id>
lamina-blueprint preview --root .lamina/blueprints --ensure --open
lamina-blueprint preview --root .lamina/blueprints --list
lamina-blueprint export-graph --root .lamina/blueprints --id <id> [--out flow-graph.mmd]
lamina-blueprint retire <id> --root .lamina/blueprints
lamina-blueprint validate .lamina/blueprints/<id>
lamina-blueprint validate run .lamina/runs/<run_id>/run.yaml
```

**Lifecycle:** Use `--ensure` to start preview in the background (idempotent — reuses running server). Use `--open` to open the system default browser (cross-platform; not IDE-specific). State is written to `.lamina/preview-state.yaml` (`id`, `port`, `url`, `pid`, `root`, `startedAt`). Read that file on later turns instead of re-spawning.

**Agent verification:** `curl http://localhost:<port>/__lamina/state?id=<id>&flowId=<flow>` returns per-screen completeness (`complete` | `skeleton` | `error`). Use before printing the preview URL to the user.

Preview features (v2): dark greyscale wireframes, right-side **React Flow** graph (pan/zoom, scenario branches, transition labels, skeleton/error node badges), flow-scoped screen overrides, hotspot highlighting, short fade on screen change, device viewport presets (Mobile/Tablet/Desktop) in preview chrome only. Missing screen files render as **skeleton placeholders** instead of errors. When `flows.tsx` is absent, preview falls back to a **provisional graph** from linked `run.yaml` `flows[]` (via `meta.yaml` `run_id`), or legacy `flows-inventory.yaml` if present. Canvas shows the **current designed state** only. Blueprint TSX files remain unstyled — radius and stage chrome are renderer-only.

### Persona lens (preview)

When `.lamina/personas.yaml` exists, preview loads a **View as** selector (top bar, default None). Selecting a persona shows a compact card below the flow graph with goals and simulation blockers. Blocker screens get a dot on flow graph nodes.

**Optional `flow` on persona** — ties a persona to a blueprint `<Flow id>`. Selecting that persona auto-switches the flow picker (same as manual flow change).

```yaml
# .lamina/personas.yaml (excerpt)
personas:
  - id: deal-hunter-diane
    flow: main          # optional — auto-switch preview to this flow
    type: primary
    goals:
      experience: ["feel smart, not duped"]
      end: ["find orders quickly"]
    # ...other required persona fields
```

Simulation results load from `.lamina/runs/*/run.yaml` `simulation` (prefer runs whose `blueprint_id` matches the active blueprint; latest per persona otherwise). Blocker `step` must match a screen id for graph dots. Personas annotate the active flow; they do not add graph branches (scenarios do).

Preview shows a DiceBear avatar per persona, with frustrations and simulation quotes in a chat-bubble slideshow (forward/back controls).

Start preview once with `lamina-blueprint preview --root .lamina/blueprints --id <id> --ensure --open`; HMR updates on file edits. URL is also in `.lamina/preview-state.yaml`.

## Brownfield extraction (existing screens)

Use when a blueprint includes **existing production screens** — audit findings, or features that reuse shipped UI. New screens in the same flow do **not** need manifest entries.

### When manifest is required

| Screen type | Signal | Manifest row? |
|-------------|--------|---------------|
| **Existing** | prior run `flows[]` `status: shipped` + `evidence`, or user cites route/file | Yes — `run.yaml` `screens[]` with `status: existing`, `source` + `elements` |
| **New** | `status: planned`, or introduced in this feature | No — design directly in `screens/<id>.tsx` |
| **Optimize override** | `flows/<flow-id>/screens/` variant | No — standard validate only |

Manifest presence enables fidelity checks. No manifest file = greenfield path (current workflow).

### Procedure

| Step | Action |
|------|--------|
| 1 | Classify each flow step: **existing** vs **new** |
| 2 | For **existing** only: resolve `source` from run evidence or user path; read source; add screen row to `run.yaml` `screens[]` |
| 3 | Scaffold `flows.tsx` — all steps, existing + new |
| 4 | Hydrate **existing** screens from manifest; **design new** screens directly (no manifest row) |
| 5 | `lamina-blueprint validate` — fix all errors before preview |
| 6 | **Self-check (existing only):** re-read each `source` file; confirm no key region or CTA was dropped |

### Brownfield screens in `run.yaml`

```yaml
screens:
  - id: cart
    status: existing
    source: app/cart/page.tsx
    regions: [Page, Main]
    elements:
      - { component: Heading, text: Your cart }
      - { component: Table, columns: [Item, Qty, Price] }
      - { component: Button, label: Checkout, trigger: to-checkout }
```

Validate enforces `status: existing` screens from linked `run.yaml` — screens without existing status pass with standard checks.

### Production → SUB mapping

| Production pattern | SUB component |
|--------------------|---------------|
| Page layout wrapper | `Page` |
| `<header>`, app bar | `Header` or `Navigation` |
| `<main>`, primary content area | `Main` |
| `<aside>`, side panel | `Sidebar` |
| `<footer>` | `Footer` |
| Content group, card, panel | `Section` |
| `flex` / `grid` row of items | `Row`, `Column`, `Stack`, or `Grid` |
| `<h1>`–`<h4>` | `Heading` with `level` |
| Paragraph, helper copy | `Text` |
| `<form>` | `Form` |
| `<input>`, `<select>`, textarea | `Field`, `Select`, `TextArea`, etc. |
| Data grid / table | `Table` with `columns` |
| `<ul>` / list UI | `List` |
| Primary/secondary buttons, links that navigate | `Button`, `Action`, `Link` + `trigger` |
| Tabs, stepper, breadcrumbs | `Tabs`, `Stepper`, `Breadcrumb` |
| Unknown / custom widget | `Placeholder as="WidgetName"` with `label` |

### Stripping rules (existing screens only)

**Drop:** `className`, `style`, CSS, decorative icons, hover/tooltip-only UI, analytics wrappers, loading spinners on structure pass.

**Keep:** region hierarchy, headings/labels, field names, table columns, flow-advancing CTAs as `trigger`.

## Workflow

1. **Create** — new `<id>` (slug from feature name); write `meta.yaml` with `status: draft` and `run_id`
2. **Scaffold** — write complete `flows.tsx` first (all transitions for every flow)
3. **Validate scaffold** — `lamina-blueprint validate .lamina/blueprints/<id>` (expect screen-file errors until screens exist — that's OK)
4. **Hydrate screens** — one flow at a time; entry screen first; then remaining screens per flow
5. **Validate before preview** — run `validate` again; fix errors before starting preview
6. **Start preview** — `lamina-blueprint preview --root .lamina/blueprints --id <id> --ensure --open`
7. **Iterate** — patch files when user requests changes in chat
8. **Approve** — set `status: approved`; append `### Blueprint handoff` to `runs/<run_id>/report.md`; set `blueprint_id` in `run.yaml`
9. **Retire** — after implementation confirmed: `lamina-blueprint retire <id>`; optional one-liner in `decisions.md`

### Handoff block (on approve)

```markdown
## Blueprint handoff (<id>)
- Read `.lamina/blueprints/<id>/` — structural spec only
- Not production code; ignore preview styling
- Retire blueprint after implementation
```

Tasks must reference **screen/flow names**, not blueprint file paths.

## Optimize (flow-level only)

Lamina **optimizes entire flows**, not isolated screens. Audit and blueprint work target a **named flow** from `run.yaml` `flows[]` (or prior runs).

When evidence exists, write **`run.yaml` `screens[]` with `status: existing` for audited screens before** hydrating blueprint TSX. Proposed changes go in `screens/` or `flows/<id>/screens/` overrides — overrides have no manifest row.

Two ways to express an optimization in a blueprint:

1. **Edit `screens/`** — update the designed state for the step under test (preview shows it directly).
2. **New alternate flow** — add `<Flow id="...">` with `flows/<id>/screens/` overrides where steps differ; compare by switching flows in the preview picker.

Edge-case states use `run.yaml` `scenarios[]` branches on the graph (variant TSX in blueprint).

## Checkpoint

Offer after design concept track steps 5, 6, end; design feature track flows and before tasks; audit findings. See `../lamina-orchestrator/prompts/checkpoints/blueprint-preview.md`.
