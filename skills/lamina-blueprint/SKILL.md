---
name: lamina-blueprint
description: "Generate and maintain semantic UX blueprints (SUB) with optional greyscale wireframe preview. Use when structuring screens, flows, or reviewing UX before implementation."
metadata:
  lamina:
    id: blueprint
    problems:
      - "wireframe preview"
      - "screen structure"
      - "UX blueprint before implementation"
      - "blueprint review"
    related:
      - lamina-flow-design
      - lamina-product-behavior
      - lamina-requirements-definition
    tags:
      - artifacts
---
# Lamina Blueprint (SUB)

**Semantic UX blueprints** — TSX structure specs, not production code. Optional greyscale wireframe preview via local URL.

**Guardrail:** Blueprints describe **structure and behavior only**. No `className`, `style`, CSS, colors, typography, or design tokens in blueprint files. Preview uses a **dark greyscale** renderer — still not a styling spec.

## When to use

- User opts into wireframe preview during ideate (steps 5, 6, end), feature, or optimize
- User describes layout changes to update a live preview
- Handoff to coding agents after blueprint approval

## Artifact layout

```
.lamina/blueprints/<id>/
  meta.yaml           # id, title, status: draft | approved
  app.tsx             # optional root
  flows.tsx           # Transition edges
  screens/
    <screen-id>.tsx
  flows/
    <flow-id>/screens/  # optional per-flow overrides (alternate flows, optimize variants)
  scenarios.yaml        # edge-case inventory for preview
  scenarios/
    <scenario-id>/screens/<screen-id>.tsx  # screen variant (empty, error, etc.)
```

Each blueprint is **disposable** — delete after implementation. Durable record: `requirements.md`, `implementation-tasks.md`, `flows-inventory.yaml`.

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

`lamina-blueprint validate` checks that every `trigger` on a screen has a matching transition in that flow; when authoring, also verify each outgoing transition has a corresponding trigger on the effective screen file.

### Edge-case scenarios (preview)

Map each edge case to a **screen variant** in the blueprint (not a separate navigation paradigm). Branch-style edge cases (different path) use a new `<Flow id>` and the flow picker.

**`scenarios.yaml`:**

```yaml
scenarios:
  - id: empty-orders
    title: No orders yet
    screen: orders
    flow: main              # optional — omit to show in all flows
    description: User lands before any orders exist
    severity: medium        # optional: high | medium | low
```

**Variant file:** `scenarios/<scenario-id>/screens/<screen-id>.tsx` — use `EmptyState`, `ErrorState`, `Alert`, etc.

When feature/ideate documents edge cases, write prose to `.lamina/edge-cases.md` **and** add matching `scenarios.yaml` entries + variant files to the blueprint. Preview shows scenarios as **dashed branches** on the flow graph; click a branch node to load the variant; click the main screen node to return to the happy path.

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

Screen `id` values must match entries in `.lamina/flows-inventory.yaml`.

## Preview CLI

```bash
lamina-blueprint preview --root .lamina/blueprints --id <id>
lamina-blueprint preview --root .lamina/blueprints --list
lamina-blueprint export-graph --root .lamina/blueprints --id <id> [--out flow-graph.mmd]
lamina-blueprint retire <id> --root .lamina/blueprints
lamina-blueprint validate .lamina/blueprints/<id>
```

Preview features (v2): dark greyscale wireframes, right-side **React Flow** graph (pan/zoom, scenario branches, transition labels), flow-scoped screen overrides, hotspot highlighting, short fade on screen change, device viewport presets (Mobile/Tablet/Desktop) in preview chrome only. Canvas shows the **current designed state** only. Blueprint TSX files remain unstyled — radius and stage chrome are renderer-only.

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

Simulation results load from `.lamina/personas/simulations/*.yaml` (latest per persona). Blocker `step` must match a screen id for graph dots. Personas annotate the active flow; they do not add graph branches (scenarios do).

Preview shows a DiceBear avatar per persona, with frustrations and simulation quotes in a chat-bubble slideshow (forward/back controls).

Start preview in a background terminal once; HMR updates on file edits. Print URL: `http://localhost:5173?id=<id>`.

## Workflow

1. **Create** — new `<id>` (slug from feature name); write `meta.yaml` with `status: draft`
2. **Generate** — write `screens/*.tsx` and `flows.tsx` from ideate/feature content; for multi-screen flows, add `trigger` on each screen that can advance the flow (hotspot walkthrough)
3. **Iterate** — patch files when user requests changes in chat
4. **Approve** — set `status: approved`; append handoff block to `requirements.md`
5. **Retire** — after implementation confirmed: `lamina-blueprint retire <id>`; optional one-liner in `decisions.md`; update `flows-inventory.yaml` to `shipped`

### Handoff block (on approve)

```markdown
## Blueprint handoff (<id>)
- Read `.lamina/blueprints/<id>/` — structural spec only
- Not production code; ignore preview styling
- Retire blueprint after implementation
```

Tasks must reference **screen/flow names**, not blueprint file paths.

## Optimize (flow-level only)

Lamina **optimizes entire flows**, not isolated screens. Audit and blueprint work target a **named flow** from `.lamina/flows-inventory.yaml` (or a new flow you are proposing).

Two ways to express an optimization in a blueprint:

1. **Edit `screens/`** — update the designed state for the step under test (preview shows it directly).
2. **New alternate flow** — add `<Flow id="...">` with `flows/<id>/screens/` overrides where steps differ; compare by switching flows in the preview picker.

Edge-case states use `scenarios.yaml` branches on the graph, not separate optimize artifacts.

## Checkpoint

Offer after ideate steps 5, 6, end; feature flows and before tasks; optimize findings. See `prompts/checkpoints/blueprint-preview.md`.
