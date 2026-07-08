---
name: lamina-edge-cases
description: "Systematic edge-case mapping from data and operations to UX scenarios. Use when mapping failure, empty, permission, conflict, and boundary states to screens and blueprint scenarios."
metadata:
  lamina:
    id: edge-cases
    problems:
      - "edge case mapping"
      - "operational failure states"
      - "empty and error state discovery"
      - "permission and conflict UX"
      - "data-driven edge cases"
    related:
      - lamina-blueprint
      - lamina-error-handling
      - lamina-empty-states
      - lamina-feedback-and-status
      - lamina-flow-design
      - lamina-product-behavior
    tags:
      - audit-default
---
# Edge Cases

**Operational thinking at mapping time — not operational storage.** Derive what data and actions exist during the session; capture UX consequences in `run.yaml` `scenarios[]`. Never persist a separate domain model artifact.

**Guardrail:** User mental model vocabulary only. Never SQL types, ORM names, HTTP paths, or framework-specific terms.

## When to use

- `/lamina-design` feature track edge cases section (after flows defined)
- Blueprint checkpoint when hydrating scenario variants
- `/lamina-audit` when auditing unmapped failure/empty/permission states
- Any flow where happy-path screens exist but operational deviations are unaddressed

## Transient operation inventory (session-only)

Before writing scenarios, build an **ephemeral inventory** in work-plan prose or inline notes — not a YAML file:

1. **Read inputs:** `run.yaml` `flows[]`/`screens[]`, blueprint `screens/` + `flows.tsx` (if exists), `screens[].source` for brownfield production files
2. **Per screen, note:**
   - **Data shown:** `Table source`/`columns`, `Field name`, list content, metrics
   - **Actions:** `Button`/`Action`/`Link` triggers, form submits, navigation transitions
3. **Derive operations:** user-facing verb phrases — "view orders", "place order", "update profile" — not IDs, not API paths
4. **Hold in context** for the outcome matrix step; discard after scenarios are written

Brownfield: read production files cited in `evidence` during this session. No inference pipeline, no persisted extraction.

## Outcome matrix

For each operation from the inventory, enumerate non-happy outcomes and map to category + UX pattern:

| Outcome | Category | `trigger.when` | Typical `ux` |
|---------|----------|----------------|--------------|
| Nothing to show | `empty` | `collection_empty` | `empty_state` |
| Resource missing | `empty` | `not_found` | `empty_state` or `error_state` |
| Wrong lifecycle state | `precondition` | `state_disallows` | `alert` or disabled action copy |
| Incomplete/stale data | `partial` | `validation_failed` | `banner` |
| Duplicate/concurrent edit | `conflict` | `concurrent_edit` | `error_state` |
| System/validation failure | `failure` | `validation_failed` or `timeout` | `error_state` |
| Not allowed | `permission` | `forbidden` or `session_expired` | `redirect` or inline denial |
| Dependency down | `external` | `dependency_unavailable` | `banner` |
| At limit | `boundary` | `limit_reached` | `alert` or `banner` |

Branch-style edge cases (different navigation path) use `ux: alternate_flow` and a new `<Flow id>` — not a scenario variant alone.

## Checklists

1. Every operation in the inventory has at least empty + failure outcomes considered.
2. Permission and session expiry checked for mutating operations.
3. Concurrent edit considered for shared editable resources.
4. External dependencies flagged for operations that call third-party services.
5. Each mapped edge case has a `run.yaml` `scenarios[]` entry.
6. Scenario variant TSX at `scenarios/<id>/screens/<screen>.tsx` is **optional** — write only when documenting a distinct wireframe state; coverage review uses Scenarios view + annotation pins on happy-path screens.
7. `trigger.subject` loosely matches the relevant `Table source` or primary data on the screen.
8. Personas with low literacy or accessibility needs get permission/conflict cases reviewed.

## Mapping rules: scenario → optional variant TSX

Coverage lives in `run.yaml`. Variant TSX is optional — use when the edge case needs a visibly different wireframe state.

| `ux` | SUB components (when variant TSX written) |
|------|----------------|
| `empty_state` | `EmptyState` + primary action if applicable |
| `error_state` | `ErrorState` — preserve context, suggest recovery |
| `alert` | `Alert` inline on screen |
| `banner` | `Banner` at page/section level |
| `redirect` | Different screen or `ErrorState` with navigation action |
| `alternate_flow` | New `<Flow id>` + flow overrides — no variant file required for branch entry |

Run `lamina-blueprint validate` after writing scenarios.

## Output contract

**Always:** write `scenarios[]` to `run.yaml` during edge-case mapping.

**With blueprint (optional):** write scenario variant TSX at `.lamina/blueprints/<id>/scenarios/<id>/screens/<screen>.tsx` only when a second wireframe state is needed. Open UX Review Studio Scenarios view to review gaps and coverage without variant files.

**Never** use markdown tables for edge cases in `report.md`.

**On blueprint approve:** salient edge cases summarized in `report.md` `### Blueprint handoff` section — durable record after blueprint retirement.

## Anti-patterns

- **UI-only brainstorming:** Listing empty states without identifying which operation/data state triggers them.
- **Persisted domain model:** Writing a separate entity/operation catalog that drifts from the codebase.
- **Implementation vocabulary:** "users table", "POST /orders", "Prisma query failed".
- **Orphan scenarios:** `run.yaml` scenario missing required fields — not missing variant TSX (variants are optional).
- **Happy-path-only:** Shipping flows without permission, conflict, or external failure cases for mutating operations.

## Related capabilities

- [Blueprint](../lamina-blueprint/SKILL.md) — scenarios schema and UX Review Studio
- [Error Handling](../lamina-error-handling/SKILL.md) — message and recovery patterns
- [Empty States](../lamina-empty-states/SKILL.md) — blank slate guidance
- [Feedback and Status](../lamina-feedback-and-status/SKILL.md) — loading and async feedback
- [Flow Design](../lamina-flow-design/SKILL.md) — information framework for domain objects
- [Product Behavior](../lamina-product-behavior/SKILL.md) — mental model vs implementation model
