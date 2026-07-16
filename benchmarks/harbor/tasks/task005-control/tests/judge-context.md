# Product behavior judge context

## Task description
Audit the checkout flow for product-behavior gaps: invariant violations, state consistency failures, permission issues, error recovery, and prioritized fixes.

## Behavioral reference checklist
Use as a **rubric for product behavior**, not a phrase hunt.
Credit implemented behavior (types, handlers, UI, validation, filters, empty/error states).
Do **not** require checklist id strings or slogan comments.
Negations/bans: absence or explicit rejection counts — the ban phrase need not appear.
Trade-offs/a11y: look for chosen behavior and accessible hooks, not snake_case labels.
Cite evidence (path/symbol/control) in criterion reasoning.

### required_entities
- cart
- order
- payment
- shipping_address

### required_invariants
- order_total_matches_line_items
- payment_required_before_confirmation

### required_personas
- first_time_buyer
- returning_customer

### required_flows
- cart_review
- shipping_entry
- payment
- confirmation

### required_findings
- invariant_violation
- state_consistency
- permission_gap
- error_recovery
- idempotency_risk

### required_scenarios
- payment_declined_recovery
- address_validation_failure
- session_timeout_mid_checkout

### required_edge_cases
- payment_declined
- address_validation_failure
- session_timeout

### required_a11y
- form_labels
- error_announcement
- keyboard_checkout
