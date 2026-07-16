# Product behavior judge context

## Task description
Design and implement a complete product for subscription billing with upgrades, downgrades, and proration: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and a buildable full-product surface — not a stub.

## Behavioral reference checklist
Use as a **rubric for product behavior**, not a phrase hunt.
Credit implemented behavior (types, handlers, UI, validation, filters, empty/error states).
Do **not** require checklist id strings or slogan comments.
Negations/bans: absence or explicit rejection counts — the ban phrase need not appear.
Trade-offs/a11y: look for chosen behavior and accessible hooks, not snake_case labels.
Cite evidence (path/symbol/control) in criterion reasoning.

### required_entities
- subscription
- plan
- invoice
- payment_method
- usage_addon

### required_invariants
- downgrade_effective_end_of_period
- proration_on_upgrade
- grace_period_before_suspension

### required_personas
- account_owner
- team_admin

### required_flows
- upgrade_plan
- downgrade_plan
- payment_failed_recovery
- view_invoice

### required_rules
- proration_policy
- downgrade_timing
- grace_period

### required_scenarios
- card_expired_recovery
- chargeback_handling
- plan_discontinued_migration
- usage_overage_billing

### required_edge_cases
- card_expired
- chargeback
- plan_discontinued
- usage_overage

### required_a11y
- billing_status_clear
- charge_preview

### required_tradeoffs
- immediate_upgrade_revenue_vs_user_surprise
- grace_period_length_vs_churn_risk
