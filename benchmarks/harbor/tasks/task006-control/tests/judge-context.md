# LaminaBench judge context

## Task description
Audit document sharing and permissions in Outline for product-behavior gaps: invariant violations, state consistency failures, permission issues, error recovery, and prioritized fixes.

## Behavioral reference checklist
Use as a **rubric for product behavior**, not a phrase hunt.
Credit implemented behavior (types, handlers, UI, validation, filters, empty/error states).
Do **not** require checklist id strings or slogan comments.
Negations/bans: absence or explicit rejection counts — the ban phrase need not appear.
Trade-offs/a11y: look for chosen behavior and accessible hooks, not snake_case labels.
Cite evidence (path/symbol/control) in criterion reasoning.

### required_entities
- document
- collection
- permission
- share_link

### required_invariants
- document_permissions_bounded_by_collection
- revoked_access_immediate

### required_personas
- author
- viewer
- admin

### required_flows
- share_document
- change_permissions
- public_link

### required_findings
- permission_inheritance_gap
- invariant_violation
- revocation_failure
- multi_view_inconsistency

### required_scenarios
- permission_downgrade_propagation
- link_leak_after_revocation
- moved_document_access

### required_edge_cases
- permission_downgrade
- link_leak
- moved_document

### required_a11y
- permission_status
- share_dialog_focus
