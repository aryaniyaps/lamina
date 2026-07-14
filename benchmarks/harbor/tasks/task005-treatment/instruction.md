# Checkout Flow Audit

Audit the Vercel Commerce checkout path for product-behavior gaps, then implement the highest-priority fixes in code.

## Scope

- Cart review → shipping → payment → order confirmation
- Guest and authenticated checkout
- Totals consistency, payment-before-confirm, address validation, declined payment recovery
- Session timeout mid-checkout, idempotency risks, form accessibility (labels, errors, keyboard)

## Deliverable

A coherent, **buildable application codebase** with the highest-priority product-behavior fixes applied in source (domain/workflow/permission/recovery gaps), not a report-only audit.

Prefer focused code changes over CI/CD or production-ops work — those are out of scope. Do not refuse for scope or only write plans.

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
