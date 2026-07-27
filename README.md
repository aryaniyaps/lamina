# Lamina

Lamina is a transactional product-knowledge graph for AI coding agents. It models product intent, observed source behavior, Persona simulations, and runtime evidence without collapsing those into the same kind of truth.

## Architecture

```text
Sources ──▶ CocoIndex ──observations──▶ graphd ──▶ Ladybug
Agents  ──typed proposals─────────────▶ graphd ──▶ Ladybug
Runs    ──normalized evidence─────────▶ graphd ──▶ Ladybug + local evidence CAS
```

Ladybug is canonical. One long-running local `graphd` owns its read-write Database object and exposes a deterministic JSON protocol over a Unix socket. CocoIndex incrementally derives explicit Observation envelopes and never opens Ladybug. Git supplies source revision and branch identity; it does not store graph state.

The runtime is shared by worktrees at:

```text
$(git rev-parse --git-common-dir)/lamina/
├── graph.lbdb/
├── cocoindex/
├── evidence/
├── graphd.lock
└── graphd.sock
```

Existing legacy run files are left untouched and have no runtime meaning.

## Install

```bash
pnpm install
pnpm link --global
```

Node 20+ is required. Source observation uses `uv` and Python 3.11–3.13; the wrapper creates the pinned CocoIndex environment.

## CLI

```bash
lamina graph status
lamina graph query --workflow cancel-booking --at HEAD
lamina graph propose claim.add --input claim.json
lamina graph patch operation.cancel-booking --input patch.json
lamina graph link operation.cancel-booking invariant.refund-policy --as lamina:constrainedBy
lamina graph retire statement_... --statement
lamina graph retire operation.cancel-booking
lamina graph validate --at HEAD
lamina graph diff --base main --head HEAD
lamina graph backup --output graph.backup.json
lamina graph rebuild-observations

lamina session start
lamina session query <id>
lamina session publish <id>
lamina session rebase <id>
lamina session abort <id>

lamina mission compile --workflow <workflow-id> [--persona <persona-id>] [--adapter <manifest-id>]
lamina mission run <mission-id> --events events.json
# mission run returns an isolated session; inspect it, then:
lamina session publish <session-id>

npm run graph:observe
```

Single graph mutations use implicit sessions. Multi-fact work uses an explicit session and publishes in one serializable Ladybug transaction. Mission Runs deliberately stay in their own session until `lamina session publish`. Compare-and-swap rejects a stale session; rebase it, query again, and republish.

## Knowledge model

Resources have stable opaque ids and generic kinds such as product, actor, persona, entity, operation, workflow, invariant, surface, scenario, proof, evidence, decision, contradiction, capability_manifest, mission, run, harness_result, and observation.

Every semantic fact is one Statement:

```text
subject ─ predicate ─▶ object
subject ─ predicate ─▶ typed literal
```

Scope and semantic qualifiers are optional. Statement identity hashes normalized subject, predicate, object/literal, scope, and qualifiers. Re-proposal is idempotent; evidence links to the existing Statement. Aliases are not identities. Conflicting Statements remain present and create a Contradiction.

Ingress determines epistemic class:

| Ingress | Class |
|---|---|
| Explicit intent | intended |
| CocoIndex | observed |
| Agent proposal | inferred |
| Persona interpretation | simulated |
| Research/customer connector | human_evidence |
| Execution adapter | runtime_evidence |

Agents cannot submit epistemic class or approval. Approval means the installed validators passed, required evidence exists, and no relevant Contradiction blocks it.

`claim.add` is an agent proposal and is therefore inferred. Public graphd methods never expose a caller-selectable intended ingress. Intended knowledge can only enter through a trusted engine-owned intent adapter; quoting user input does not let an agent elevate its own proposal.

## Skills

- `/lamina-init` establishes business evidence and canonical Product/Persona/Actor resources.
- `/lamina-design` proposes and validates intended product behavior in a session.
- `/lamina-verify` compiles an independent Mission and Run for every relevant Persona.
- `/lamina` routes focused work to the graph workflow and craft skills.

Lamina commands never edit application source. Human implementation or verification Markdown is a query projection tied to a GraphVersion, not canonical state.

## Development

```bash
pnpm test
pnpm test:eval:spec
pnpm test:eval:validate
```

The transactional test suite covers atomic publication, idempotency, contradictions, concurrent sessions, semantic branch diffs, observation isolation/retry, spoof rejection, uncapped Persona Missions, arbitrary adapter modalities, evidence, and legacy-runtime removal.

License: Apache-2.0.
