# Semantic adapter contract v1

An implementation adapter accepts one implementation-native, immutable result
and returns `lamina.semantic-result/v1`. The adapter may rename fields and
recover semantic relations from implementation-native edges. It must not read
the reviewed expected fixture, repair missing behavior, hide extra behavior,
or generate expected output.

Every adapter declares:

- `schema: lamina.semantic-adapter/v1`;
- a stable `id` and adapter `version`; and
- the exact `input_format` it consumes.

The v1 result contains canonical Resources, relations, GraphVersions, branch
heads, Contradictions, implementation obligations, publication outcomes, and
derived-state authority. All arrays use the ordering rules in `contract.mjs`.
Equivalent storage or packet schemas pass when their adapters produce the same
normalized semantic object and digest.

The reviewed fixture currently contains exactly 61 executable cases and 31
seeded mutations. Its obligations intentionally mix `already_satisfied` and
`change_required` resolutions so completeness is graded in both directions.

`current-graph-backup-v1.mjs` is the explicit adapter for the bounded
`lamina.current-semantic-observation/v1` envelope. Its schema validates the
exact graph-backup records consumed by normalization, accepted WorkMap
obligation/evidence/file arrays, and operation-discriminated CLI stdout/stderr
for graph restore/status/query/backup, WorkMap derivation/check, invalid
publication, unresolved check, and tampered restore. It also carries the real
implementation-context obligations and current context-catalog authority
record. The adapter includes only records reachable from a published
GraphVersion, so abandoned or failed session-local proposals cannot masquerade
as canonical state. It never synthesizes obligations from relations.

The fixture directly seeds one canonical `GENERATED_BY` edge through the graph
engine to test preservation and a seeded loss regression. That is a fixture-
only setup path; no public generator-edge producer exists in the current CLI.
