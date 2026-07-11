# LaminaBench judge context

## Task description
Design and implement a complete product for empty states across a project management application: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and a buildable full-product surface — not a stub.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- project
- cycle
- search_result
- empty_state

### required_invariants
- error_distinct_from_empty
- actionable_cta_when_permissions_allow
- permission_limited_empty_explained

### required_personas
- new_user
- experienced_user

### required_flows
- first_project_empty
- empty_search
- empty_cycle
- error_vs_empty

### required_rules
- actionable_cta
- error_distinction
- tone_guidelines

### required_scenarios
- permission_limited_empty_state
- filtered_to_zero_results
- deleted_all_items_recovery

### required_edge_cases
- permission_limited_empty
- filtered_to_zero
- deleted_all_items

### required_a11y
- empty_state_announced
- cta_focus_order

### required_tradeoffs
- guidance_vs_clutter
- encouraging_tone_vs_accuracy

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- implementation brief
