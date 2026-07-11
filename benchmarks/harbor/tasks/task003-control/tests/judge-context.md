# LaminaBench judge context

## Task description
Design and implement a full volunteer coordination product — not a signup demo: domain model, illegal states, actors and permissions, post/fill/check-in/hours/certification workflows, edge cases, named trade-offs, and buildable coordinator + volunteer surfaces.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- opportunity
- shift
- volunteer
- certification
- organization
- hours_record
- background_check

### required_invariants
- shift_capacity_not_exceeded
- background_check_before_assignment
- min_age_enforced

### required_personas
- coordinator
- volunteer
- org_admin

### required_flows
- post_opportunity
- volunteer_signup
- shift_checkin
- hours_reporting
- certification_renewal
- coordinator_staffing

### required_rules
- background_check_required
- min_age_requirement
- shift_capacity

### required_scenarios
- no_show_handling
- certification_expired_block
- overbooked_shift_prevention
- expired_cert_blocks_assignment

### required_edge_cases
- no_show
- certification_expired
- overbooked_shift
- last_minute_cancel

### required_a11y
- screen_reader_support
- simple_language_mode

### required_tradeoffs
- coordinator_control_vs_volunteer_flexibility

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- implementation brief
