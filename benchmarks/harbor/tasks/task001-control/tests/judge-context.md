# LaminaBench judge context

## Task description
Design and implement a full household budgeting product — not a demo stub: domain model, illegal states, actors and permissions, all primary workflows (onboarding, linking, weekly review, alerts, partner invite, settings), edge cases, named trade-offs, and a buildable multi-surface product.

## Behavioral reference checklist
Use as a **rubric for product behavior**, not a phrase hunt.
Credit implemented behavior (types, handlers, UI, validation, filters, empty/error states).
Do **not** require checklist id strings or slogan comments.
Negations/bans: absence or explicit rejection counts — the ban phrase need not appear.
Trade-offs/a11y: look for chosen behavior and accessible hooks, not snake_case labels.
Cite evidence (path/symbol/control) in criterion reasoning.

### required_entities
- household
- account
- transaction
- budget
- category
- alert
- household_member

### required_invariants
- one_active_budget_per_household
- partner_privacy_boundary
- no_investment_advice_display

### required_personas
- primary_budgeter
- partner
- occasional_viewer

### required_flows
- onboarding
- account_linking
- weekly_review
- category_adjustment
- spending_alert
- invite_partner
- household_settings

### required_rules
- no_investment_advice
- shared_household_view
- privacy_between_partners

### required_scenarios
- sync_failure_recovery
- zero_income_month
- duplicate_transaction_handling
- partner_privacy_category_hidden

### required_edge_cases
- empty_accounts
- sync_failure
- duplicate_transactions
- zero_income_month

### required_a11y
- screen_reader_labels
- large_touch_targets
- color_not_only_indicator

### required_tradeoffs
- clarity_vs_granularity
- shared_view_vs_partner_privacy
