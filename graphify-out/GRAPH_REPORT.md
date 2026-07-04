# Graph Report - .  (2026-07-04)

## Corpus Check
- Corpus is ~1,513 words - fits in a single context window. You may not need a graph.

## Summary
- 14 nodes · 13 edges · 4 communities (2 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Package Metadata|Package Metadata]]
- [[_COMMUNITY_NPM Scripts|NPM Scripts]]
- [[_COMMUNITY_CLI Binary Mapping|CLI Binary Mapping]]
- [[_COMMUNITY_Node Runtime Constraint|Node Runtime Constraint]]

## God Nodes (most connected - your core abstractions)
1. `scripts` - 4 edges
2. `bin` - 2 edges
3. `engines` - 2 edges
4. `lamina` - 1 edges
5. `test` - 1 edges
6. `lamina` - 1 edges
7. `verify:bundle` - 1 edges
8. `node` - 1 edges
9. `license` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (4 total, 2 thin omitted)

### Community 0 - "Package Metadata"
Cohesion: 0.33
Nodes (5): description, license, name, type, version

### Community 1 - "NPM Scripts"
Cohesion: 0.50
Nodes (4): scripts, lamina, test, verify:bundle

## Knowledge Gaps
- **10 isolated node(s):** `name`, `version`, `description`, `type`, `lamina` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `scripts` connect `NPM Scripts` to `Package Metadata`?**
  _High betweenness centrality (0.423) - this node is a cross-community bridge._
- **Why does `bin` connect `CLI Binary Mapping` to `Package Metadata`?**
  _High betweenness centrality (0.154) - this node is a cross-community bridge._
- **Why does `engines` connect `Node Runtime Constraint` to `Package Metadata`?**
  _High betweenness centrality (0.154) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._