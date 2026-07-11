# LaminaBench judge context

## Task description
Design and implement a complete product for screen-reader support on a data-heavy analytics dashboard: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and a buildable full-product surface — not a stub.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- dashboard
- chart
- filter
- data_table

### required_invariants
- no_color_only_status
- text_alternative_for_every_chart
- focus_order_logical

### required_personas
- screen_reader_user
- keyboard_user
- sighted_analyst

### required_flows
- navigate_dashboard
- explore_chart
- apply_filter
- export_data

### required_rules
- text_alternatives
- no_color_only
- focus_management

### required_scenarios
- live_region_overflow_handling
- empty_chart_accessible_state
- loading_state_announced

### required_edge_cases
- live_region_overflow
- empty_chart
- loading_state

### required_a11y
- aria_live_regions
- table_navigation
- chart_descriptions
- skip_links

### required_tradeoffs
- data_density_vs_screen_reader_verbosity
- live_updates_vs_cognitive_load

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- implementation brief
