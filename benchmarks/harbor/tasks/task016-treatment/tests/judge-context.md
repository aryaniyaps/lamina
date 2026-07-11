# LaminaBench judge context

## Task description
Design and implement a complete product for healthcare appointment scheduling with complex insurance rules: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and a buildable full-product surface — not a stub.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- patient
- appointment
- insurance_plan
- prior_authorization

### required_invariants
- eligibility_verified_before_booking
- prior_auth_blocks_scheduling
- copay_displayed_before_confirm

### required_personas
- patient
- scheduler
- insurance_coordinator

### required_flows
- eligibility_check
- book_in_network
- prior_auth_wait
- out_of_network_option

### required_rules
- insurance_verification_gate
- prior_auth_required
- copay_display

### required_scenarios
- eligibility_timeout_retry
- partial_coverage_communication
- auth_denied_alternative
- plan_change_mid_booking

### required_edge_cases
- eligibility_timeout
- partial_coverage
- auth_denied
- plan_change_mid_booking

### required_a11y
- plain_language_insurance
- error_recovery_paths

### required_tradeoffs
- real_time_eligibility_vs_wait_time
- in_network_restriction_vs_patient_choice

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- policy enforcement
- implementation brief
