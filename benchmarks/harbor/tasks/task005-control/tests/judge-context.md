# LaminaBench judge context

## Task description
Audit the checkout flow for product-behavior gaps: invariant violations, state consistency failures, permission issues, error recovery, and prioritized fixes.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

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

### required_sections
- executive summary
- findings
- prioritized improvements
