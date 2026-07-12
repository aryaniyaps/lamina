# LaminaBench judge context

## Task description
Design and implement a complete product for offline editing in a collaborative document editor: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and a buildable full-product surface — not a stub.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- document
- edit_operation
- sync_queue
- conflict

### required_invariants
- no_data_loss_on_reconnect
- conflict_resolution_policy_defined
- offline_indicator_always_visible

### required_personas
- frequent_editor
- occasional_viewer

### required_flows
- edit_offline
- reconnect_sync
- conflict_resolution
- view_offline

### required_rules
- offline_indicator
- sync_queue
- conflict_policy

### required_scenarios
- extended_offline_queue_overflow
- conflicting_edits_merge
- auth_expired_offline_recovery

### required_edge_cases
- extended_offline
- conflicting_edits
- storage_full
- auth_expired_offline

### required_a11y
- status_announcements
- offline_mode_screen_reader

### required_tradeoffs
- last_write_wins_vs_manual_merge
- queue_size_vs_storage

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- recovery paths
- implementation brief
