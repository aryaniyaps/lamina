## Business goals
Reduce checkout abandonment and payment-support tickets caused by inconsistent totals, failed recovery, and unclear errors.

## Users
- First-time buyers (often guest checkout)
- Returning customers with saved details

## Constraints
- Brownfield Next.js Commerce; review source and any `.lamina/` flow inventory if present
- Do not redesign the entire storefront — fix checkout behavior gaps
- Payment must be required before confirmation; order total must match line items
