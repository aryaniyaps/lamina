# LaminaBench judge context

## Task description
Design and implement bulk issue actions in Plane as a complete feature: domain model, illegal states, actors and permissions, multi-select/bulk workflows, edge cases, named trade-offs, and a buildable product surface that fits Plane.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- issue
- bulk_selection
- permission
- project

### required_invariants
- permission_check_per_issue
- undo_window_for_destructive
- max_selection_enforced

### required_personas
- team_lead
- project_manager

### required_flows
- multi_select
- bulk_state_change
- bulk_assign
- bulk_delete_confirm

### required_rules
- permission_check_per_issue
- undo_window
- max_selection

### required_scenarios
- partial_permission_denied_feedback
- mixed_project_selection_block
- selection_across_pages

### required_edge_cases
- partial_permission_denied
- mixed_project_selection
- selection_across_pages

### required_a11y
- selection_count_announced
- keyboard_multi_select

### required_tradeoffs
- bulk_speed_vs_per_item_confirmation
- cross_page_selection_vs_performance

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- implementation brief
