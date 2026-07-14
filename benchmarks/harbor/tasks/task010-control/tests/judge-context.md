# LaminaBench judge context

## Task description
Design and implement a complete product for session expiration and re-authentication: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and a buildable full-product surface — not a stub.

## Behavioral reference checklist
Use as a **rubric for product behavior**, not a phrase hunt.
Credit implemented behavior (types, handlers, UI, validation, filters, empty/error states).
Do **not** require checklist id strings or slogan comments.
Negations/bans: absence or explicit rejection counts — the ban phrase need not appear.
Trade-offs/a11y: look for chosen behavior and accessible hooks, not snake_case labels.
Cite evidence (path/symbol/control) in criterion reasoning.

### required_entities
- session
- auth_token
- unsaved_work
- sso_provider

### required_invariants
- unsaved_work_preserved_on_reauth
- warning_before_expiry
- mid_action_graceful_recovery

### required_personas
- active_user
- idle_user

### required_flows
- idle_warning
- extend_session
- reauth_preserve_work
- expired_mid_submit

### required_rules
- warning_timing
- work_preservation
- sso_redirect

### required_scenarios
- sso_failure_recovery
- concurrent_session_conflict
- unsaved_form_data_preservation

### required_edge_cases
- sso_failure
- concurrent_sessions
- unsaved_form_data

### required_a11y
- timeout_warning_announced
- focus_on_modal

### required_tradeoffs
- security_timeout_vs_workflow_disruption
- extend_session_vs_force_reauth
