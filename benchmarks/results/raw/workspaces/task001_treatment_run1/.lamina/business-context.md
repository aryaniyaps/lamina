---
name: household-budgeting-business-context
description: Business context for the Household Budgeting App project
metadata:
  type: business
---

# Business Context

## Business Goals
- Launch a budgeting app that reaches **40% weekly active usage** within **90 days** by reducing financial anxiety through clarity.

## Target Users
- **Primary budgeter** (age 25‑40) – manages the household budget.
- **Partner** – shares visibility with privacy boundaries for personal categories.
- **Occasional viewer** – e.g., co‑parent checking balances.

## Constraints
- Mobile‑first (iOS & Android) for the US market.
- Offline viewing of balances is required; sync may fail and must recover gracefully.
- No investment advice or tax filing guidance.
- Prefer clarity over transaction‑level granularity when they conflict.

## Core Requirements
- Domain model covering households, linked accounts, transactions, budgets, categories, alerts, and household membership.
- Exactly one active budget per household; partners share a household view with a privacy boundary for personal categories.
- Primary flows: onboarding, account linking, weekly review, category adjustment, spending alerts, invite partner, household settings.
- Secondary surfaces: empty/zero‑income states, sync‑error recovery UI, notification preferences, category privacy controls.
- Handle sync failures, duplicate transactions, empty accounts, and zero‑income months without data loss or blame UX.

## Accessibility
- Mobile‑first UI with screen‑reader labels, large touch targets, and status indications not relying solely on color.

## Edge Cases
- Empty or zero‑income states.
- Sync‑error recovery.
- Duplicate transactions.
- Privacy boundaries for personal categories.

*This document provides the business context needed for UX and design work.*