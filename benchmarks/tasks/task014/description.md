# Cart Experience Audit

Audit the Vercel Commerce cart for behavioral friction, state consistency, and abandonment risks, then implement a **minimal vertical slice** of the highest-priority fixes.

## Scope

- Add-to-cart feedback, cart modal/page, quantity updates, remove item, proceed to checkout
- Cart total matches items; out-of-stock items not checkoutable
- Price-change transparency, empty-cart recovery, idempotent quantity updates
- Announced cart updates and accessible quantity controls

## Deliverable

- Findings on state consistency, idempotency, price transparency, inventory invariants
- Prioritized fixes; implement the top slice that reduces cart abandonment risk in code
