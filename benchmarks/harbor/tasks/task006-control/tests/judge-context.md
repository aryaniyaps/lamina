# LaminaBench judge context

## Task description
Design and implement recurring issues in Plane as a complete feature: domain model, illegal states, actors and permissions, series/occurrence workflows, edge cases, named trade-offs, and a buildable product surface that fits Plane.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- recurring_issue
- occurrence
- issue
- project
- cycle

### required_invariants
- one_occurrence_per_schedule_slot
- assignee_inheritance_on_series
- recurrence_respects_project_permissions

### required_personas
- team_lead
- individual_contributor

### required_flows
- create_recurrence
- complete_occurrence
- skip_occurrence
- edit_series
- end_recurrence

### required_rules
- recurrence_end_conditions
- timezone_handling
- assignee_inheritance

### required_scenarios
- deleted_project_series_handling
- permission_denied_occurrence
- cycle_boundary_conflict

### required_edge_cases
- deleted_project
- permission_denied
- cycle_boundary
- duplicate_occurrence

### required_a11y
- keyboard_shortcuts
- screen_reader_recurrence_description

### required_tradeoffs
- series_edit_vs_single_occurrence_edit
- timezone_consistency_vs_user_local_display

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- tradeoffs and decisions
- implementation brief
