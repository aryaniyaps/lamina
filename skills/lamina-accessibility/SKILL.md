---
name: lamina-accessibility
description: "Accessibility in contracts and verify — semantic structure, keyboard paths, and a11y findings on live UI. Not CSS framework prescriptions."
metadata:
  lamina:
    id: accessibility
    problems:
      - "accessible interaction design"
      - "keyboard and screen reader paths"
      - "inclusive verify pass"
    related:
      - lamina-content-design
      - lamina-forms
      - lamina-navigation
    tags:
      - audit-default
---
# Accessibility (agent-native)

Accessibility is **usability for all actors** — specified as **machine fields on `screens[]`** and verified on live product or static source during `/lamina-verify`.

## Contract encoding (`screens[].a11y`)

Required on every screen with `status: new`:

```yaml
a11y:
  labels: every primary control has accessible name (aria-label or visible label)
  touch_min_px: 48
  color_not_only: true
  keyboard: primary path completable without pointer   # optional but recommended
```

Also capture in screen elements when useful:
- Heading structure intent (h1–h6)
- Form fields: label text, error association
- State not conveyed by color alone (icon/text required)

In verify `findings[]`: a11y failures with `fix_target: product` and observable `acceptance`.

**Identifier discipline:** Derive ids from the current brief and observed product behavior. Never optimize ids or notes for an external evaluator, golden file, or phrase match.

## Verify procedure

1. Walkthrough capture at `base_url` when available; else static source.
2. For each `screens[].a11y`: assert labels on primary controls, touch targets ≥ `touch_min_px`, color-not-only for status.
3. Actor walk with accessibility constraints from persona when present.
4. Missing hooks → product finding with evidence path/symbol.

**Three-second structure test**: disable CSS/images mentally — does content order and link text still make sense?

## Checklists

1. Every `status: new` screen has `a11y.labels` + `a11y.touch_min_px` + `a11y.color_not_only`.
2. All workflow primary paths keyboard-completable.
3. Error messages programmatically associated with fields.
4. Implement.md Must-implement lists `a11y.*` ids; fix.md unticked checklist includes misses.

## Anti-patterns

- "Add a11y later" without `screens[].a11y` or findings.
- Color-only status indicators in contract.
- Image-only controls without text alternative.
- Skipping a11y because design phase has no runnable UI — encode in contract now; verify later.
- Renaming a11y concepts so phrase checks miss (`aria stuff` instead of screen-reader labels).

## Related

- [Content Design](../lamina-content-design/SKILL.md)
- [Forms](../lamina-forms/SKILL.md)
- [Verify](../lamina-verify/SKILL.md)
