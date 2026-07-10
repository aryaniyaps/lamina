# Empty States Design

Design and implement complete empty-state behavior for a project-management app (projects, cycles, search): first-run guidance, contextual empties, and hard distinction from errors.

## Requirements

- First-project empty with guided CTA; empty cycle; empty/zero search; error-vs-empty distinction
- When permissions block creation, explain why — do not show a dead CTA
- Handle filtered-to-zero results and "deleted all items" recovery differently from first-run empty
- Announce empty states; sensible CTA focus order
- Tone: encouraging but accurate — never claim data exists when it does not
- Trade-off: guidance vs clutter; encouraging tone vs accuracy

## Deliverable

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and a usable product surface. Do not stop at a single-screen or thin demo stub.
