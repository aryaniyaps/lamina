# Recurring Tasks for Plane

Design and implement recurring issues in Plane that fit existing projects, cycles, assignees, and permissions.

## Requirements

- Create a recurring issue series (daily, weekly, monthly, custom) that spawns occurrences
- Complete vs skip a single occurrence; edit series vs single occurrence; end recurrence
- One occurrence per schedule slot; assignees inherit from the series; respect project permissions
- Handle timezone display, cycle-boundary conflicts, deleted projects, and permission-denied occurrences
- Show recurrence clearly in list and detail views without breaking Kanban/List patterns
- Keyboard shortcuts and screen-reader-friendly recurrence descriptions

## Deliverable

A coherent, buildable **complete feature** implementation that fits the existing product: domain model, primary workflows end-to-end, edge/recovery paths, and UI that matches the host app patterns. Do not stop at a stub or single-path demo.

## Context

## Business goals
Reduce repetitive issue creation for team leads running standup rituals, releases, and ops checklists inside Plane.

## Users
- Team leads creating and managing series
- Individual contributors completing or skipping occurrences

## Constraints
- Brownfield: must fit Plane's issue states, cycles, modules, labels, and project permissions
- See product-context.md in the workspace for existing UX (sidebar, Kanban/List)
- Trade-offs: series edit vs single-occurrence edit; timezone consistency vs local display
