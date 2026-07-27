---
name: lamina-orchestrator
description: "Transactional product-graph workflows for design, source observation, Persona Missions, and runtime verification."
---

# Lamina Orchestrator

Ladybug, owned by the long-running local `graphd`, is the only canonical product graph. CocoIndex sends source Observations to graphd. Agents send typed proposals. Mission adapters send normalized runtime evidence. Git supplies branch identity and source revisions, not graph storage.

## Modes

| Mode | Action |
|---|---|
| Init | Write/index business evidence, then propose inferred Product and Persona resources grounded in explicit user input |
| Design | Explicit graph session → validate → publish |
| Verify | Compile all relevant Persona Missions → isolated Runs → runtime evidence |
| Direct | One-shot session for a single typed mutation or query |

## Runtime

Use `lamina graph`, `lamina session`, and `lamina mission`. Raw Cypher writes are forbidden. All agent-facing output is deterministic JSON with GraphVersion, source revision, results, Contradictions, validation receipt, and stable error codes.

Legacy the active GraphVersion files are untouched indexable source evidence and have no runtime meaning. Do not discover or select them.
