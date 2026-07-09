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

Accessibility is **usability for all actors** — specified in screen contracts and verified on **live product** during `/lamina-verify`.

## Contract encoding

Per `screens[]`:
- Heading structure intent (h1–h6 hierarchy)
- Primary actions reachable by keyboard
- Form fields: label text, error association
- State not conveyed by color alone (icon/text required)
- Focus order notes for multi-step flows

In `scenarios[]`: a11y failures as `findings[]` with severity.

## Verify procedure

1. Walkthrough capture at `base_url` (visual-walkthrough pattern).
2. A11y subagent or lens on captured steps: keyboard nav, labels, contrast flags, heading order.
3. Actor walk with `accessibility` constraints from persona (screen reader, keyboard-only).

**Three-second structure test**: disable CSS/images mentally — does content order and link text still make sense? Run via walkthrough describer when multimodal unavailable.

## Checklists

1. Semantic structure in screen spec — not presentation classes.
2. All workflow primary paths keyboard-completable.
3. Error messages programmatically associated with fields.
4. WCAG-oriented baseline; cite level target in `decisions.md` if user requires.
5. Accessible design often improves mobile and clarity for everyone.

## Anti-patterns

- "Add a11y later" without scenarios for gaps.
- Color-only status indicators in contract.
- Image-only controls without text alternative in screen spec.
- Skipping a11y because design phase has no runnable UI — defer to verify, don't skip.

## Related

- [Content Design](../lamina-content-design/SKILL.md)
- [Forms](../lamina-forms/SKILL.md)
- [Verify](../lamina-verify/SKILL.md)
