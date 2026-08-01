---
name: lamina-evaluation
description: "Judge product usability and evidence quality. Use when running Persona-based walkthroughs on a built product, planning an expert heuristic review, defining evidence-backed success metrics, or checking quantitative claims without inventing measurements. Use lamina-research to plan or synthesize evidence collection and lamina-ux to design interaction behavior."
---

# Lamina Evaluation

## Reference-loading protocol

1. Match the request's primary evaluation method to one row below.
2. Open that linked reference before answering. Add another only when a second
   method materially changes the answer; do not preload the directory.
3. Start the response with `Using lamina-evaluation: <topic path(s)>` so the
   selected evaluation lens is auditable.

## Topic index

| Evaluation signal | Read | Adds |
|---|---|---|
| Need actors to attempt workflows and edge probes on a built product | [Actor Evaluation](references/usability-evaluation.md) | Persona-based walkthrough method and reproducible blockers |
| Need specialists to inspect a contract or live product through explicit lenses | [Expert Lens Review](references/heuristic-review.md) | parallel lens coverage tied to evidence and contract refs |
| Need success metrics, analytics interpretation, or experiment claims | [Metrics Discipline](references/quantitative-validation.md) | measurement boundaries and anti-fabrication rules |

## Working rule

Use the smallest sufficient reference set. Actor evaluation requires a runnable
product; use expert review before build or when a lens-specific inspection is
requested. Pair either with metrics discipline only when real measurements or a
measurement plan are in scope.
