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

## Context

## Business goals
Reduce checkout abandonment and payment-support tickets caused by inconsistent totals, failed recovery, and unclear errors.

## Users
- First-time buyers (often guest checkout)
- Returning customers with saved details

## Constraints
- Brownfield Next.js Commerce; review source and any `.lamina/` flow inventory if present
- Do not redesign the entire storefront — fix checkout behavior gaps
- Payment must be required before confirmation; order total must match line items
