---
name: lamina-product-discovery
description: "Frame product problems and decide what to build. Use when establishing business context, aligning actors with conflicting goals, discovering or prioritizing features, defining traceable requirements, comparing consequential tradeoffs, or recording a product decision. Use lamina-ux for interaction details and lamina-product-behavior for authoritative runtime rules."
---

# Lamina Product Discovery

## Reference-loading protocol

1. Match the request's primary product decision to one row below.
2. Open that linked reference before answering. Add another only when a second
   decision materially changes the answer; do not preload the directory.
3. Start the response with `Using lamina-product-discovery: <topic path(s)>` so
   the selected decision lens is auditable.

## Topic index

| Decision signal | Read | Adds |
|---|---|---|
| Need to turn a vague request into a bounded problem and explicit non-goals | [Problem Framing](references/problem-framing.md) | actors, outcomes, domain boundary, and blocking unknowns |
| Need to establish or update the product's business foundation | [Business Context](references/business-context.md) | evidence-backed context artifact, assumptions, and changelog |
| Need to reconcile goals, permissions, or conflicts across multiple actors | [Multi-Actor Goal Alignment](references/stakeholder-alignment.md) | explicit conflict resolution and authority mapping |
| Need to derive candidate product behavior from an outcome or user ask | [Feature Discovery](references/feature-discovery.md) | entities, operations, workflows, and clarify gates |
| Need to choose which workflows or risks belong in the current slice | [Scope Prioritization](references/feature-prioritization.md) | invariant-, actor-, dependency-, and verification-aware priority |
| Need to express accepted scope as testable product behavior | [Requirements Definition](references/requirements-definition.md) | promises, graph nodes, scenarios, and traceability |
| Need to classify assumptions, policy forks, or high-consequence choices | [Product Decisions and Tradeoffs](references/tradeoffs.md) | reversibility, provenance, confidence, and blocking rules |
| Need to rank findings or decide whether a change targets product or contract | [Decision Making](references/decision-making.md) | impact filter, fix target, and next-action ordering |

## Working rule

Use the smallest sufficient reference set. Common sequences are problem framing
then feature discovery, and tradeoffs then decision making. Business Context is
for establishing or updating the durable foundation, not every feature choice.
Preserve permissions, states, failures, recovery, relationships, and evidence
limits.
