# LaminaBench judge context

## Task description
Design and implement a storefront wishlist as a complete feature: domain model, illegal states, actors and permissions, guest/registered workflows, edge cases, named trade-offs, and a buildable product surface that fits Commerce.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- wishlist
- wishlist_item
- product
- cart
- guest_session

### required_invariants
- guest_wishlist_merge_on_login
- out_of_stock_not_purchasable
- price_at_add_time_displayed

### required_personas
- guest_shopper
- registered_user
- gift_buyer

### required_flows
- add_to_wishlist
- view_wishlist
- move_to_cart
- share_wishlist
- guest_merge

### required_rules
- guest_persistence
- out_of_stock_handling
- price_change_notification

### required_scenarios
- guest_session_expired_recovery
- product_discontinued_removal
- duplicate_add_idempotency

### required_edge_cases
- product_discontinued
- guest_session_expired
- empty_wishlist
- duplicate_add

### required_a11y
- wishlist_button_label
- bulk_action_feedback

### required_tradeoffs
- guest_persistence_vs_privacy
- price_notification_vs_noise

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- implementation brief
