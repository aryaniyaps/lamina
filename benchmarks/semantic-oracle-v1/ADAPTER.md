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

`current-graph-backup-v1.mjs` is the explicit adapter for a bounded current
observation envelope: `lamina-graph-backup-v1`, publication receipts, the real
implementation-context obligation compiler and WorkMap statuses, plus the
current context-catalog authority record. It includes only records reachable
from a published GraphVersion, so abandoned or failed session-local proposals
cannot masquerade as canonical state. It never synthesizes obligations from
relations.
