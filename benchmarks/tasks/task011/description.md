# Checkout Flow Audit

Audit the Vercel Commerce checkout path for product-behavior gaps, then implement the highest-priority fixes in code.

## Scope

- Cart review → shipping → payment → order confirmation
- Guest and authenticated checkout
- Totals consistency, payment-before-confirm, address validation, declined payment recovery
- Session timeout mid-checkout, idempotency risks, form accessibility (labels, errors, keyboard)

## Deliverable

- Findings covering invariant violations, state consistency, permission gaps, error recovery, and idempotency
- Prioritized fixes; implement the highest-priority fixes that harden checkout behavior across the audit scope
