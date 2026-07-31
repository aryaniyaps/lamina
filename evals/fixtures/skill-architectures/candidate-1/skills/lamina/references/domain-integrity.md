# domain integrity

This is a routing index. Select a leaf from the problem signal; do not load the pack wholesale.

| Signal | Reference | Purpose |
|---|---|---|
| `system_structure` | [system-structure](domain-integrity/system-structure.md) | Product system structure — entities, relationships, purpose, and quantities that change over time. Use when defining what exists in the product domain and how parts connect. |
| `invariants` | [invariants](domain-integrity/invariants.md) | Product invariants — rules that must always hold, impossible states prevented, errors defined out of existence. Use when defining what can never happen in the product. |
| `dependencies` | [dependencies](domain-integrity/dependencies.md) | Map prerequisite, data, lifecycle, and reachability dependencies between typed product-graph nodes, including explicit behavior when a dependency is unmet. |
| `modularity_boundaries` | [modularity-boundaries](domain-integrity/modularity-boundaries.md) | Domain and feature boundaries — hide complexity behind clear ownership, pull complexity away from users. Use when splitting entities, actors, and responsibilities. |
| `evolutionary_rules` | [evolutionary-rules](domain-integrity/evolutionary-rules.md) | Evolving product rules safely — reversible decisions, invariant checks as features change, deferring commitment. Use when the domain will grow or requirements are uncertain. |
| `system_traps` | [system-traps](domain-integrity/system-traps.md) | Recurring product failure modes from system structure — policy resistance, shifting burden, tragedy of commons. Use when fixes keep failing or symptoms return. |
| `leverage_points` | [leverage-points](domain-integrity/leverage-points.md) | High-impact intervention points in product design — rules, information flows, and goals over UI tweaks. Use when local fixes fail to change behavior. |
| `feedback_loops` | [feedback-loops](domain-integrity/feedback-loops.md) | Feedback loops in product behavior — balancing and reinforcing dynamics, delays, and oscillation. Use when state changes feed back into further change. |
