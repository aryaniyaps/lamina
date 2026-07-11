# LaminaBench judge context

## Task description
Design and implement a full collaborative trip planner — not a packing-list stub: domain model, illegal states, actors and permissions, itinerary/voting/expense/invite/offline workflows, edge cases, named trade-offs, and a buildable collaborative product surface.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- trip
- itinerary_item
- expense
- member
- vote
- invite
- settlement

### required_invariants
- invite_only_trip_access
- organizer_approval_for_changes
- expense_currency_consistency

### required_personas
- trip_organizer
- contributor
- passive_member

### required_flows
- create_trip
- add_activity
- vote_on_option
- split_expense
- settle_up
- invite_members
- leave_trip

### required_rules
- invite_only_access
- organizer_approval
- expense_currency

### required_scenarios
- member_leaves_group_settlement
- conflicting_votes_resolution
- offline_sync_reconciliation
- offline_edit_conflict

### required_edge_cases
- member_leaves_group
- conflicting_votes
- offline_sync
- timezone_changes

### required_a11y
- readable_maps_alternative
- notification_preferences

### required_tradeoffs
- collaboration_vs_organizer_control
- offline_access_vs_live_sync

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- implementation brief
