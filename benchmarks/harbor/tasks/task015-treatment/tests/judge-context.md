# LaminaBench judge context

## Task description
Audit new-user onboarding in Plane for product-behavior gaps: invariant violations, state consistency failures, permission issues, error recovery, and prioritized fixes.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- workspace
- project
- invite
- issue

### required_invariants
- workspace_requires_owner
- invite_expires_after_ttl

### required_personas
- new_admin
- invited_member

### required_flows
- workspace_setup
- first_project
- invite_team

### required_findings
- empty_state_guidance_gap
- workflow_dead_end
- permission_confusion
- time_to_value_blocker

### required_scenarios
- solo_user_onboarding_path
- invite_expired_recovery
- abandoned_setup_resume

### required_edge_cases
- solo_user
- invite_expired
- abandoned_setup

### required_a11y
- onboarding_step_labels

### required_sections
- executive summary
- findings
- quick wins
