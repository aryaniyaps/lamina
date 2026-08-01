---
name: lamina
description: "Route ordinary product implementation and explicit Lamina lifecycle requests. Use passively after initialization for changes to product behavior, flows, permissions, states, failures, or UI; skip purely mechanical maintenance."
---

# /lamina

Use this as the compact Lamina router. The public catalog has four workflow
skills and six capability skills. Load only the entrypoint and topic references
needed for the current request.

Before graph work, read
[the CLI prerequisite](orchestrator/prerequisites/cli-required.md). `/lamina-init`
is the one explicit onboarding action. After initialization, ordinary product
implementation language is the primary route.

## Workflow routes

- `/lamina-init`: use [lamina-init](../lamina-init/SKILL.md).
- Ordinary feature, behavior fix, flow refactor, or UI work: prepare the graph
  context, complete design gaps with [lamina-design](../lamina-design/SKILL.md),
  derive and check the WorkMap, implement, collect evidence, and run
  `lamina work verify`.
- Explicit `/lamina-design`: use [lamina-design](../lamina-design/SKILL.md) as a
  graph-only advanced override; never edit application source in that phase.
- Explicit `/lamina-verify`: use [lamina-verify](../lamina-verify/SKILL.md) as a
  source-read-only advanced override; never edit application source in that
  phase.
- Focused product question: select one primary capability below, read its
  `SKILL.md`, then read the smallest relevant topic set before answering. Start
  the response with `Using <capability>: <topic(s)>` so routing is visible and
  deprecated focused names are never implied.

Never recommend `/lamina-design` or `/lamina-verify` as a next step in normal
flow. Execute the required phase implicitly. Ask a question only when an
unresolved decision would materially change the product contract.

Classify wording by requested action, not by the presence of a product problem:
“help with,” “what should,” “how should,” critique, explanation, or planning
without a request to change repository files is a focused question. Answer it
through capability references without requiring initialization or entering the
implementation workflow. Requests to add, fix, redesign, refactor, or otherwise
change product behavior use the ordinary implementation route.

### Focused-question protocol

For a focused question, do not answer from this router alone and do not suggest
the implementation lifecycle. You must:

1. Open the selected capability's sibling `SKILL.md`.
2. Open every topic reference needed for the answer.
3. Begin the answer with `Using <capability>: <topic(s)>`.

If the sibling or reference cannot be read, report the missing installed path
instead of improvising its guidance.

## Capability routes

| Need | Skill |
|---|---|
| Evidence scope, actor walks, grounding, synthesis, research communication | [lamina-research](../lamina-research/SKILL.md) |
| Problem framing, business context, priorities, requirements, tradeoffs | [lamina-product-discovery](../lamina-product-discovery/SKILL.md) |
| Flows, IA, navigation, forms, content, accessibility, feedback, trust | [lamina-ux](../lamina-ux/SKILL.md) |
| Invariants, dependencies, consistency, concurrency, time, side effects | [lamina-product-behavior](../lamina-product-behavior/SKILL.md) |
| Structure, feedback loops, traps, leverage, evolution | [lamina-systems](../lamina-systems/SKILL.md) |
| Persona usability, heuristic review, quantitative validation | [lamina-evaluation](../lamina-evaluation/SKILL.md) |

For detailed signal-to-topic routing, read the
[problem router](references/problem-router.md). Old public names are a hard
cutover; use the installed [legacy-name lookup](references/migration-map.md) to
locate their new capability and topic. Read the optional
[glossary](references/glossary.md) only when unfamiliar Lamina or product-design
terminology blocks routing; it is not a second topic index.

## Ordinary implementation contract

1. Run `lamina work prepare` without `--workflow` first. Never invent a
   workflow ref; narrow only a genuinely ambiguous result with an exact ref.
2. If design gaps exist, run one independent graph-resident Persona walk per
   active Persona, union discoveries, expand the graph, and repeat the full
   round until every discovery array is empty.
3. Run `lamina work map`, resolve every obligation and Persona-bound Experience
   Case to valid implementation and test files, then run `lamina work check`.
   The checked map is immutable.
4. Implement the mapped work.
5. Reconcile with one-shot `lamina graph observe`, run and publish every active
   Persona Mission, and pass `lamina work verify` with the unchanged map.

Every current Persona walk covers every operation node, including denied and
inapplicable nodes, and explicitly evaluates authorization, inputs,
relationship identity and cardinality, required states, declared Scenarios,
Invariant probes, transitions, and all required edge-case axes. Graph closure
is authoritative; source retrieval only localizes evidence and code.

Every compiled Experience Case needs one passing oracle event with a structured
observation and reproducible artifact. UI obligations require distinct
functional, visual, responsive, and accessibility evidence. Missing audit
capability blocks verification.

## Hard rules

- Ladybug is canonical and `graphd` is the sole writer.
- Never expose raw Cypher or accept caller-supplied epistemic or approval state.
- Never treat legacy run files, graph dumps, generic screenshots, or broad
  mappings as substitutes for current graph and Mission evidence.
- Use sessions for multi-fact design changes and preserve stable Resource
  identity.
- Do not cap active Personas.
- Explicit design and verification phases do not edit application source.

Supporting orchestration is internal to this skill under
[`orchestrator/`](orchestrator/load-protocol.md); it is not a public skill.
