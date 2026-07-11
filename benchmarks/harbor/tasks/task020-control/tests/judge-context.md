# LaminaBench judge context

## Task description
Design and implement a complete product for multi-stage employee onboarding across HR, IT, and team leads: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and a buildable full-product surface — not a stub.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- onboarding_checklist
- task
- stage
- new_hire
- compliance_training

### required_invariants
- compliance_gate_before_system_access
- task_dependencies_enforced
- stage_ownership_clear

### required_personas
- new_hire
- hr_coordinator
- it_admin
- hiring_manager

### required_flows
- onboarding_kickoff
- it_provisioning
- team_introduction
- compliance_training

### required_rules
- task_dependencies
- compliance_gate
- stage_ownership

### required_scenarios
- delayed_start_date_handling
- role_change_mid_onboarding
- it_provisioning_failure_recovery

### required_edge_cases
- delayed_start
- role_change_mid_onboarding
- it_provisioning_failure

### required_a11y
- progress_visibility
- deadline_reminders

### required_tradeoffs
- parallel_tasks_vs_sequential_compliance
- automation_vs_human_handoff

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- recovery flows
- implementation brief
