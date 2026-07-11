# Household Budgeting App

Design and implement a full mobile-first household budgeting product for young US families — not a demo stub. Cover the complete product surface: onboarding through ongoing weekly use, partner sharing, alerts, and settings.

## Requirements

- Domain: household, linked accounts, transactions, budgets, categories, alerts, and household membership
- Exactly one active budget per household; partners share a household view with a privacy boundary for personal categories
- Primary flows: onboarding, account linking, weekly review, category adjustment, spending alerts, invite partner, household settings
- Secondary surfaces: empty/zero-income states, sync-error recovery UI, notification preferences, category privacy controls
- Handle sync failures, duplicate transactions, empty accounts, and zero-income months without data loss or blame UX
- Never display investment advice or tax filing guidance
- Accessible mobile UI (screen-reader labels, large touch targets, status not by color alone)

## Deliverable

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and enough UI that a household could actually use the product. Do not stop at a single-screen or thin demo stub.

## Context

## Business goals
Launch a budgeting app that reaches 40% weekly active usage within 90 days by reducing financial anxiety through clarity.

## Users
- Primary budgeter (25–40) managing the household budget
- Partner with shared visibility and personal privacy needs
- Occasional viewer (e.g. co-parent checking balances)

## Constraints
- Mobile-first (iOS and Android); US market only
- Offline viewing of balances required; sync may fail and must recover
- No investment or tax advice anywhere in the product
- Prefer clarity over transaction-level granularity when they conflict
