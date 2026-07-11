# LaminaBench judge context

## Task description
Design and implement a complete product for enterprise RBAC in a multi-tenant admin console: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and a buildable full-product surface — not a stub.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- role
- permission
- org
- team
- audit_log

### required_invariants
- last_super_admin_protected
- permission_inheritance_transitive
- sso_group_mapping_consistent

### required_personas
- org_admin
- security_officer
- team_lead
- end_user

### required_flows
- create_role
- assign_permissions
- assign_user_role
- audit_review

### required_rules
- inheritance_hierarchy
- last_admin_protection
- sso_group_mapping

### required_scenarios
- conflicting_permissions_resolution
- role_deletion_with_active_users
- sso_sync_delay_handling

### required_edge_cases
- conflicting_permissions
- role_deletion_with_users
- sso_sync_delay

### required_a11y
- permission_matrix_navigation
- destructive_confirmations

### required_tradeoffs
- granular_permissions_vs_admin_complexity
- inheritance_vs_explicit_override

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- policy enforcement
- implementation brief
