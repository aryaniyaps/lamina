# modularity boundaries

> Migrated intact from `skills/lamina-modularity-boundaries/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Modularity Boundaries

Divide the product into cohesive parts with clear ownership. Users see simple surfaces; complexity lives behind boundaries that match domain seams.

## Decision frameworks

- **Deep boundary**: Small public surface (what actors can do) hiding substantial internal rules (how state changes are validated).
  - When to use: Complex domains exposed through simple operations ("download ticket" hides payment, venue, timing rules).
  - How: One user-facing operation per coherent outcome.

- **Information hiding**: Actors see only what their role requires (student sees own ticket; invigilator sees roster for assigned venue only).
  - When to use: Multi-actor products, permission-sensitive data.
  - How: Map actor × entity visibility in `actors`; never leak cross-boundary data in UI.

- **Pull complexity downward**: Callers (users, other features) stay simple; hard rules live inside the owning boundary (exam cell owns venue assignment logic, not the student app).
  - When to use: Shared entities touched by multiple workflows.

- **General-purpose vs specialized boundaries**: Prefer boundaries that serve one domain concept well over "god" features that expose every field.

## Checklists

1. Assign each entity a single owning actor or subsystem in product terms.
2. List what each actor type can see and do — nothing else.
3. Avoid pass-through screens that expose another boundary's internals.
4. When two features share an entity, define which boundary owns writes.
5. Document boundaries in the transactional graph `domain` relationships and `actors` permissions.

## Anti-patterns

- **Leaky boundary**: Student screen shows raw admin flags or internal status codes.
- **Shallow module**: Many screens for one concept with no hiding of rules.
- **Split ownership**: Two actors can both mutate the same field without coordination rules.

## Examples

- **Ticket regeneration**: Student boundary — request reissue (if allowed). Exam cell boundary — approve, assign venue, void old ticket. Student never directly edits venue or voids tickets.

## Related capabilities

- System Structure
- Multi-View Integrity
- Product Behavior
