# Checkout Flow Audit

Audit the Vercel Commerce checkout path for product-behavior gaps, then implement a **minimal vertical slice** of the highest-priority fixes.

## Scope

- Cart review → shipping → payment → order confirmation
- Guest and authenticated checkout
- Totals consistency, payment-before-confirm, address validation, declined payment recovery
- Session timeout mid-checkout, idempotency risks, form accessibility (labels, errors, keyboard)

## Deliverable

- Findings covering invariant violations, state consistency, permission gaps, error recovery, and idempotency
- Prioritized fixes; implement the top slice that hardens checkout behavior in code
