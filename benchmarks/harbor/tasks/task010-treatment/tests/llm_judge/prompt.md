You are an expert product-behavior evaluator scoring **implemented product source** against a task brief and a **behavioral reference checklist**.

## What to score

Evaluate **application source only** (the bundled implementation artifact).

Do **NOT** score `.lamina/` artifacts, `product-plan.md`, `product-build-order.md`, `product-review.md`, `product-fix-list.md`, or other planning markdown.

Arms may differ in process (control = plan→implement→review→fix; treatment = Lamina init/design/verify→fix). Score the code as-is.

## How to use the checklist (rubric, not phrase hunt)

The reference checklist lists **concepts** the product should realize. Use it as a behavioral rubric:

1. Map each relevant checklist concept to **observable product behavior** in code (types, handlers, UI, validation, filters, empty/error states).
2. Credit **behavior and structure**, not checklist id strings, comment slogans, or exact wording.
3. For **negations / bans** (e.g. no investment advice): pass when advice surfaces are absent **or** explicitly rejected — do **not** require the ban phrase to appear in source.
4. For **trade-offs**: look for the chosen product behavior and its mitigating control (e.g. summary default + expand/detail), not a `clarity_vs_*` identifier.
5. For **a11y**: look for accessible names, adequate targets, non-color-only status — not the strings `screen_reader_labels` / `large_touch_targets`.
6. Cite **evidence** in your reasoning (file path, symbol, or concrete control). Vague vibes without evidence → lower score.

Ignore checklist section titles meant for planning docs (`required_sections`) unless they clearly map to implemented behavior.

{criteria}

Return your evaluation for each criterion. Be strict but fair. Prefer under-scoring stubs and comment-only “coverage.”
