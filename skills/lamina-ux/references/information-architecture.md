# Information Architecture (agent-native)

Organize **Entity Resources** for actor retrieval—recency, search, and
hierarchy—not filesystem or schema shape.

## Contract encoding

- Entity relationships and actor tasks drive navigation sections and Surface groupings
- Retrieval patterns per entity type: list, search, timeline, facets — in screen spec
- Entity-to-Entity Statements inform parent/child navigation—not foreign keys in UI copy

## Frameworks

- **Unified object model**: actors manipulate domain objects (tickets, exams), not paths or tables.
- **Retrieval**: recency + search + visual browse — match how actors remember work.
- **Auto-persist**: no "save?" anxiety — session/history scenarios if undo needed.

## Design checklists

1. IA follows task analysis operations, not org chart.
2. Recent/frequent objects promoted on dashboard screen.
3. Search across entity attributes actors know (name, date) — not internal ids.
4. Deep hierarchy only for rare admin paths.
5. Entity rename in domain → nav label update in same contract pass.

## Verify checks

- Actor walk: find entity by primary retrieval path on live product.
- "Where did it go?" after create operation → finding if contract promised visibility.

## Anti-patterns

- Exposing file paths, table names, module ids to actors.
- Folder drilling as only retrieval path.
- IA copied from database ERD without task mapping.
