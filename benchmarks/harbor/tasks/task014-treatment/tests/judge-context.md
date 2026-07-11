# LaminaBench judge context

## Task description
Audit the cart experience for product-behavior friction and abandonment risks: invariant violations, state consistency failures, permission issues, error recovery, and prioritized fixes.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- cart
- cart_item
- product
- price

### required_invariants
- cart_total_matches_items
- out_of_stock_not_checkoutable

### required_personas
- browsing_shopper
- ready_to_buy

### required_flows
- add_to_cart
- update_quantity
- remove_item
- proceed_checkout

### required_findings
- state_consistency
- idempotency_risk
- price_transparency_gap
- inventory_invariant_violation

### required_scenarios
- out_of_stock_in_cart_handling
- price_change_notification
- empty_cart_recovery

### required_edge_cases
- out_of_stock_in_cart
- price_change
- empty_cart

### required_a11y
- cart_updates_announced
- quantity_controls

### required_sections
- executive summary
- findings
