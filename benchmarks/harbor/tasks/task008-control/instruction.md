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

A coherent, **buildable application codebase** that implements the product behaviors in this brief: domain model, primary workflows end-to-end, edge/recovery paths, and a usable product surface in source.

Prefer one pragmatic stack you can finish (TypeScript/Node + simple web UI is fine for mobile-first briefs — keep the UI mobile-friendly). Scoring judges **application source**, not CI/CD, app-store packaging, push infrastructure, or production ops — those are out of scope.

Do not stop at a single-screen or thin demo stub. Do not refuse for scope or only write plans.

## Context

## Business goals
Reduce billing support tickets by 40% by making plan changes and failures predictable.

## Users
- Account owners changing plans and payment methods
- Team admins with billing visibility (not always payment authority)

## Constraints
- Stripe integration; monthly and annual plans; usage-based add-ons
- Never suspend during an active grace period without warning
- Show charge preview before confirming upgrades
