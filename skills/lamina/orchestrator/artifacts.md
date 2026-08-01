# Lamina storage and projections

Canonical graph runtime:

```text
$(git rev-parse --git-common-dir)/lamina/
├── graph.lbdb
├── cocoindex/
├── evidence/
├── graphd.lock
├── graphd.log
├── graphd.token
└── graphd.sock
```

On Windows, `graphd.sock` is replaced by the repository-specific
`\\.\pipe\laminadev-<hash>` transport. The authentication token remains in the
Git-common runtime directory.

Ladybug stores Resources, Statements, aliases, versions, branch/session/observation views, Missions, Runs, and HarnessResults. CocoIndex stores only incremental target tracking and memoized computations. Large runtime artifacts live in the local evidence CAS.

`.lamina/business-context.md`, `.lamina/personas.json`, documentation, and legacy artifacts are source evidence. Existing legacy run files remain untouched but are meaningless to the runtime.

Implementation, verification, report, and fix Markdown may be generated from graph queries. Every projection must name its GraphVersion and source revision and must never be read back as canonical graph state.
