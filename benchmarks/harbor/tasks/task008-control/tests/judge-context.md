# LaminaBench judge context

## Task description
Design and implement guest document sharing in Outline as a complete feature: domain model, illegal states, actors and permissions, share/revoke workflows, edge cases, named trade-offs, and a buildable product surface that fits Outline.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- document
- guest_invite
- collection
- permission
- share_link

### required_invariants
- expired_link_denies_access
- guest_permissions_subset_of_document
- revocation_immediate

### required_personas
- document_author
- team_member
- external_guest

### required_flows
- share_with_guest
- guest_access
- revoke_access
- comment_as_guest

### required_rules
- expiration_policy
- permission_levels
- audit_trail

### required_scenarios
- expired_link_access_denied
- guest_email_mismatch
- collection_permission_conflict

### required_edge_cases
- expired_link
- guest_email_mismatch
- document_moved
- collection_permission_conflict

### required_a11y
- permission_status_visible
- guest_mode_indicator

### required_tradeoffs
- link_sharing_convenience_vs_security
- comment_access_vs_read_only

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- tradeoffs and decisions
- implementation brief
