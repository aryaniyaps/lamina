---
name: lamina-product-behavior
description: "Define authoritative runtime product truth across actors and views. Use when modeling domain behavior, setting product density, specifying side effects, protecting invariants, choosing consistency guarantees, handling retries or concurrent actions, defining time semantics and prerequisites, drawing ownership boundaries, or keeping views coherent. Use lamina-systems for causal loops and change over time, and lamina-ux for interaction expression."
---

# Lamina Product Behavior

## Reference-loading protocol

1. Match the request's primary runtime-truth decision to one row below.
2. Open that linked reference before answering. Add another only when a second
   decision materially changes the answer; do not preload the directory.
3. Start the response with `Using lamina-product-behavior: <topic path(s)>` so
   the selected behavior lens is auditable.

## Topic index

| Runtime signal | Read | Adds |
|---|---|---|
| Need the represented domain model to match how actors understand the task | [Product Behavior](references/product-behavior.md) | entities, permissions, workflows, surfaces, and illegal states |
| Need to choose how much power or complexity each actor sees | [Product Density](references/platform-posture.md) | actor- and surface-specific complexity budgets |
| One mutation must update, notify, invalidate, audit, or retry elsewhere | [Side Effects](references/side-effects.md) | primary effect, downstream effects, delivery lifecycle, and failure recovery |
| Need a rule that must hold in every valid state | [Invariants](references/invariants.md) | explicit predicates and violation probes |
| Views may lag or disagree after a state change | [Consistency Guarantees](references/consistency-guarantees.md) | strong, eventual, and read-your-writes product promises |
| An operation may repeat, race, conflict, or arrive after state changed | [Idempotency and Concurrency](references/idempotency-concurrency.md) | duplicate safety, conflict policy, and fencing |
| Behavior depends on zones, dates, recurrence, duration, deadline, or correction | [Time Semantics](references/time-semantics.md) | explicit temporal meaning and boundary behavior |
| A workflow requires prior setup, ownership, state, or another workflow | [Dependencies](references/dependencies.md) | prerequisite edges and unmet behavior |
| Need to decide which domain owns a rule or what data crosses a boundary | [Modularity Boundaries](references/modularity-boundaries.md) | information hiding and cohesive ownership |
| Several roles or surfaces must agree on the same entity and lifecycle | [Multi-View Integrity](references/multi-view-integrity.md) | handoffs, visibility, and cross-view truth |

## Working rule

Use the smallest sufficient reference set. Common pairs are invariants +
idempotency for consequential writes, consistency + multi-view integrity for
role-based products, and side effects + time semantics for scheduled delivery.
Keep behavior in product language; do not prescribe implementation machinery
unless the user asks for it.
