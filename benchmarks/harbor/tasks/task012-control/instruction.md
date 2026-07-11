# Project Settings Audit

Audit Plane project settings and configuration for product-behavior gaps, then implement the highest-priority fixes in code.

## Scope

- Project creation/configuration, member invite/roles, workflow states, integration settings
- Last-admin protection, role/permission consistency, destructive-action guards
- Multi-view inconsistency and inheritance confusion in settings UX
- Invalid invites and conflicting settings recovery

## Deliverable

- Findings on permission clarity, destructive guards, multi-view inconsistency, inheritance confusion
- Prioritized fixes (including quick wins); implement the highest-priority fixes across the settings audit scope

## Context

## Business goals
Prevent admin lockouts and permission mistakes that block teams from using Plane safely.

## Users
- Project admins configuring projects and roles
- Team members affected by role and workflow changes

## Constraints
- Brownfield Plane settings used by team leads and admins
- Last admin must not be removable; role permissions must stay consistent after edits
- Prefer targeted fixes over a settings redesign
