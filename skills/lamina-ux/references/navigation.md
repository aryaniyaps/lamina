# Navigation (agent-native)

Encode **wayfinding** as Statements on Surface Resources—site identity,
section, local navigation, and breadcrumbs—so implementers and Mission runners
test orientation.

## Contract encoding

Per screen:
- `section`, `parent`, `breadcrumb` path
- `persistent_nav`: sections, utilities, search availability
- `page_title` must match link text from parent screen

## Deep-page orientation audit (verify)

On random deep screen from walkthrough, actor subagent answers within 5 seconds:
1. What product/site is this?
2. What screen am I on?
3. What are major sections?
4. What are local options?
5. Where am I in hierarchy?
6. Is search available?

Observed failures become finding Resources linked to Mission evidence.

## Design checklists

1. Persistent nav skeleton consistent across interior screens (except home variants).
2. Breadcrumbs show hierarchy, not click history.
3. Search: one box, whole product — no pre-select search type.
4. Section landing pages orient before depth.
5. Frequent tasks shortcut from home/dashboard screen spec.

## Anti-patterns

- Page title ≠ link text.
- Missing site identity on deep pages.
- Org-chart navigation mirroring team structure.
- Orphan screens with no section context in contract.
