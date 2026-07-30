# Persona panels

Before implementation, query every active Persona, prepare one
`lamina.persona-walk-task/v1` per Persona, and run each in an isolated
subagent/context. Record every result through graphd, union discoveries into
the graph, and repeat until a current full round returns empty discovery
arrays. A non-empty matrix blocks implementation. Never cap, rank away,
combine, or omit a Persona as "irrelevant"; use explicit denied or
not-applicable nodes with rationale.

After implementation, run `lamina mission compile --workflow <id>` for runtime
verification. Each Mission receives only its Persona, assumed Actors, relevant
workflow closure, adapter capabilities, proof requirements, budget, and
observed evidence. Each Run uses independent mutable state.

Persona interpretation is simulated in both phases. Design-walk records are
simulated graph evidence; adapter events are runtime evidence. Never call
either panel user research, never fabricate results or events, and never
promote a preference without external evidence.
