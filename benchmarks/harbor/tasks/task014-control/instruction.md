# Cart Experience Audit

Audit the Vercel Commerce cart for behavioral friction, state consistency, and abandonment risks, then implement the highest-priority fixes in code.

## Scope

- Add-to-cart feedback, cart modal/page, quantity updates, remove item, proceed to checkout
- Cart total matches items; out-of-stock items not checkoutable
- Price-change transparency, empty-cart recovery, idempotent quantity updates
- Announced cart updates and accessible quantity controls

## Deliverable

- Findings on state consistency, idempotency, price transparency, inventory invariants
- Prioritized fixes; implement the highest-priority fixes that reduce cart abandonment risk across the audit scope

## Context

## Business goals
Reduce cart abandonment from stale prices, stock surprises, and unclear quantity/total feedback.

## Users
- Browsing shoppers adding items casually
- Ready-to-buy shoppers updating quantity and checking out

## Constraints
- Brownfield Commerce cart (modal + page)
- Totals and inventory state must stay consistent with line items
- Prefer behavioral fixes over visual redesign
