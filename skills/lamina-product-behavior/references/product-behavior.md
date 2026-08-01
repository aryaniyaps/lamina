# Product Behavior (agent-native)

The **represented model** in the transactional graph must match how actors conceive tasks — simpler than implementation, aligned with domain invariants.

## Contract encoding

| Layer | Graph representation |
|-------|----------|
| Domain truth | Entity and Invariant Resources plus their Statements |
| What actors can do | Actor, Operation, and Workflow Resources linked by authority and step Statements |
| What UI shows | Surface Resources realizing allowed Operations; no affordance for forbidden Operations |
| Illegal states | Scenario Resources, Invariant Statements, and visible disabled/hidden behavior |

**Implementation model** stays in external code. Lamina specifies **represented model** only.

## Frameworks

- **Goals vs tasks**: Design for stable goals; eliminate tasks technology made obsolete.
- **Capability / viability / desirability**: Record trade-offs as Decision
  Resources and Statements when pillars conflict.
- **Design values**: e.g. don't make actors feel stupid — use as filter when reconciling persona panel conflicts.
- **Patterns**: Modeless feedback and reversible actions become graph facts;
  their implementation Markdown is only a GraphVersion query projection. Do
  not prescribe a UI library.

## Design checklists

1. No screen shows actions the actor cannot perform (or shows why disabled).
2. Entity names in UI match canonical Entity aliases.
3. States visible to actors match the entity lifecycles — no mystery modes.
4. Primary actor path optimized; edge cases in scenarios, not driving IA.
5. Deviations from common patterns are linked to a Decision Resource.

## Verify checks

- Actor walks: forbidden operations blocked with scenario-matching `ux`.
- Invariant probes: UI never implies illegal state (e.g. two active tickets).
- Walkthrough: represented labels match contract entity names.

## Anti-patterns

- **Elastic user**: Generic actor justifying any design choice.
- **UI after coding**: Contract written to match accidental implementation.
- **Implementation-shaped menus**: File/Edit mirroring backend modules.
- **Feature lists without goals**: Workflows not traceable to actor outcomes.
