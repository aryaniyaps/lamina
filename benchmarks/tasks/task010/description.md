# Bulk Issue Actions

Design and implement a **minimal vertical slice** of multi-select bulk actions for Plane issues across List and Kanban views.

## Requirements

- Multi-select issues; bulk change state, assignee, labels, cycle, module; confirm destructive actions
- Permission checked per issue; partial failures reported clearly; undo window for destructive bulk ops
- Enforce max selection size; block mixed-project selections that would violate project boundaries
- Handle selection across pages and partial permission denial without silent skips
- Announce selection count; support keyboard multi-select
- Trade-off: bulk speed vs per-item confirmation; cross-page selection vs performance
