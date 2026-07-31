# design process

> Migrated intact from `skills/lamina-design-process/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Design Process (agent-native)

The loop for coding agents is passive after init: **seed proposed flow →
independent Persona walks → expand graph to a fixed point → prepare context →
map obligations → implement → verify → fix → re-verify**.

## Loop

1. `/lamina-init` once — establish the domain and provider rules.
2. Seed a minimal proposed Workflow for new functionality; implementation code is not required.
3. Prepare and record one engine-bound design walk per active Persona.
4. Union discovered Personas, Actors, nodes, permissions, states, Scenarios, Invariants, Surfaces, branches, and open decisions into the graph; rerun all walks until a current full round returns empty discovery arrays.
5. Compile the ImplementationPacket from the exact expanded graph closure.
6. Mechanically scaffold every obligation and case row with `lamina work map`, resolve each to `modify|create` implementation/test files, and check the immutable map before edits.
7. Implement in the project's stack.
8. Run isolated actor, invariant, functional, visual, responsive, and accessibility proof.
9. Fix failures and reverify until every compiled case has published Mission evidence.

`/lamina-design` and `/lamina-verify` remain advanced graph-only/source-read-only
overrides. Never recommend them as the normal next step.

## Anti-patterns

- **Workshop theater** — sticky notes, double-diamond ceremonies without contracts
- **Verify-only personas** — waiting until a product exists before using Persona perspectives
- **Skip verify** — shipping without runtime Missions against the live product
- **One-shot design** — no iteration after build

## Related

- Design
- Verify
