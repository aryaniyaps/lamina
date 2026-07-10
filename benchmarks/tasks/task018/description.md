# Subscription Billing Workflow

Design and implement a complete SaaS subscription plan-change product: immediate prorated upgrades, end-of-period downgrades, failed-payment grace, and invoice clarity.

## Requirements

- Upgrade charges prorated immediately; downgrade takes effect at period end
- Grace period before suspension on failed payment; clear invoice history and upcoming charges
- Flows: upgrade, downgrade, payment-failed recovery, view invoice
- Handle expired card recovery, chargebacks, discontinued-plan migration, usage-addon overage
- Billing status and charge preview must be unambiguous
- Trade-off: immediate upgrade revenue vs user surprise; grace length vs churn risk

## Deliverable

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and a usable product surface. Do not stop at a single-screen or thin demo stub.
