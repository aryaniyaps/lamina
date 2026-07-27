# dev-simple-list — lamina init

Use the installed `$lamina` skill and its contained `/lamina-*` routes fully. Follow Mode B: during `/lamina-*` commands write only under `.lamina/`; implement application source in separate coding turns. Do not skip persona-panel native Task children, risk-skill loads, or authority/lifecycle modeling because this is a development pilot — those are part of how Lamina works.

Route through the installed `$lamina` skill and run **only** `/lamina-init`. Write real `business-context.md` + evidence-grounded `personas.json` (≥2 materially distinct personas). Observe those sources, publish canonical Product, Persona, and Actor Resources through an explicit graph session, then export evaluator evidence with `mkdir -p .lamina/benchmark && lamina graph backup --output .lamina/benchmark/init-graph.json`. Do not implement application code in this step.

## Lamina development pilot profile

- Contract stage: start from **`spark`**. Model authority, privacy, and lifecycle boundaries in `reduce`/`project`.
- Delivery posture: in-memory reducer + HTML UI in `/app`.
- Design must run the persona-panel via native Task children before publishing the validated design GraphVersion.
- Mode B: during `/lamina-*` write only `.lamina/`; implement app source in coding turns.
## Required native persona Task children

Spawn **≥2 materially distinct personas** using Cursor's native Task/subagent tool (`taskToolCall`), not parent-authored simulation. Each child must run on requested `composer-2.5`. Preserve child `agentId`, success, duration, and conversation steps in the parent transcript; publish only normalized simulated evidence through graphd.

## Development-only persona provenance envelope

This pilot accepts Cursor native `taskToolCall` metadata in the parent session when independent child `system.init` events are unavailable:

- parent `system.init.model = Composer 2.5`
- native `taskToolCall` with child `agentId`
- requested child model `composer-2.5`
- successful completion, duration, and conversation steps

Record `child_actual_model_unverified: true`. This pilot cannot satisfy the claim-ready LaminaBench-6 native-child contract.


## Founder brief

# A tiny household list

I want a pleasant little list for one person to capture a few things, mark them done, and clear completed items. Keep it simple and friendly. Please shape the product and build the next coherent version.
