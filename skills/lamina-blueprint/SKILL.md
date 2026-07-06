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
  baseline/screens/   # optimize diff only
  proposed/screens/   # optimize diff only
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

Optional `<Flow id="...">` groups transitions when multiple flows exist. Preview shows a visual flow graph in the sidebar; click nodes or `trigger` elements to navigate. **Next steps** chips list outgoing transitions from the current screen.

Screen `id` values must match entries in `.lamina/flows-inventory.yaml`.

## Preview CLI

```bash
lamina-blueprint preview --root .lamina/blueprints --id <id>
lamina-blueprint preview --root .lamina/blueprints --list
lamina-blueprint preview --root .lamina/blueprints --id <id> --diff
lamina-blueprint export-graph --root .lamina/blueprints --id <id> [--out flow-graph.mmd] [--diff]
lamina-blueprint retire <id> --root .lamina/blueprints
lamina-blueprint validate .lamina/blueprints/<id>
```

Preview features (v2): dark greyscale wireframes, sidebar flow graph, clickable `trigger` navigation, next-steps strip. Optimize mode shows Baseline/Proposed tabs and diff badges on changed screens.

Start preview in a background terminal once; HMR updates on file edits. Print URL: `http://localhost:5173?id=<id>`.

## Workflow

1. **Create** — new `<id>` (slug from feature name); write `meta.yaml` with `status: draft`
2. **Generate** — write `screens/*.tsx` and `flows.tsx` from ideate/feature content
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

## Optimize diff

1. Create blueprint id (e.g. `optimize-checkout`)
2. Write `baseline/screens/` for **changed** screens only (from existing UX)
3. Write `proposed/screens/` for changed screens only
4. Unchanged screens fall back to `screens/` in the preview
5. `lamina-blueprint preview --id optimize-checkout --diff` — **Baseline / Proposed tabs** appear only on screens with distinct `baseline/` and `proposed/` files; changed screens show a dot in the sidebar; `export-graph --diff` marks changed nodes with dashed borders in Mermaid output

## Checkpoint

Offer after ideate steps 5, 6, end; feature flows and before tasks; optimize findings. See `prompts/checkpoints/blueprint-preview.md`.
