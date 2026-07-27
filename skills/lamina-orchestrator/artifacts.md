# Lamina storage and projections

Canonical graph runtime:

```text
$(git rev-parse --git-common-dir)/lamina/
├── graph.lbdb/
├── cocoindex/
├── evidence/
├── graphd.lock
└── graphd.sock
```

Ladybug stores Resources, Statements, aliases, versions, branch/session/observation views, Missions, Runs, and HarnessResults. CocoIndex stores only incremental target tracking and memoized computations. Large runtime artifacts live in the local evidence CAS.

`.lamina/business-context.md`, `.lamina/personas.json`, documentation, and legacy artifacts are source evidence. Existing the active GraphVersion files remain untouched but are meaningless to the runtime.

Implementation, verification, report, and fix Markdown may be generated from graph queries. Every projection must name its GraphVersion and source revision and must never be read back as canonical graph state.
