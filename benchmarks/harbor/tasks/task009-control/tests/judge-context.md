# LaminaBench judge context

## Task description
Design and implement saved searches in the catalog as a complete feature: domain model, illegal states, actors and permissions, save/rerun/alert workflows, edge cases, named trade-offs, and a buildable product surface that fits Commerce.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- saved_search
- filter
- product
- notification

### required_invariants
- max_saved_searches_enforced
- filter_snapshot_immutable_until_edit

### required_personas
- frequent_shopper
- b2b_buyer

### required_flows
- save_search
- run_saved_search
- edit_saved_search
- notification_opt_in

### required_rules
- max_saved_searches
- notification_frequency

### required_scenarios
- no_new_matches_notification
- filter_deprecated_handling
- duplicate_name_prevention

### required_edge_cases
- no_new_matches
- filter_deprecated
- duplicate_name

### required_a11y
- search_results_announcement
- filter_state_persistence

### required_tradeoffs
- notification_frequency_vs_relevance

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- implementation brief
