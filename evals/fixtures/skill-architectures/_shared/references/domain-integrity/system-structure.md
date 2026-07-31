# system structure

> Migrated intact from `skills/lamina-system-structure/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# System Structure

Map the product as a system in the transactional graph `domain` — elements, interconnections, purpose — before screens or external implementation.

## Verify

Re-read `domain` after external build: actor walks and invariant probes must reference the same entities and relationships; drift → `findings[]`.

## Decision frameworks

- **Three-part system definition**: Elements + interconnections + purpose. A random list of screens is not a system; exams, venues, tickets, and the rules linking them are.
  - When to use: Scoping any feature or domain area.
  - How: Name entities, how they affect each other, and the product outcome the system serves.

- **Stocks and flows (product quantities)**: Stocks are accumulations (tickets issued, seats remaining, unpaid fees). Flows are rates of change (registrations per day, cancellations).
  - When to use: Any persistent quantity users care about — inventory, capacity, status counts.
  - How: Identify stock, inflows, outflows; stocks change slowly and act as buffers and delays.

- **Purpose revealed by behavior**: Stated goals may differ from what the product actually optimizes. Design for the behavior you want, not the slogan.
  - When to use: Resolving conflicts between marketing copy and product rules.

- **Interconnections over parts**: Information links often matter more than physical data movement. Who knows what, when, drives behavior.
  - When to use: Multi-actor products (student, admin, exam cell).

## Checklists

1. List domain entities and relationships before screens.
2. For each entity, note ownership — who creates, updates, or deletes it.
3. Identify stocks users care about (tickets left, exam capacity).
4. Map inflows and outflows for each stock.
5. State the system's purpose in one sentence testable against workflows.
6. Distinguish real system from mere collection of unrelated features.

## Heuristics

- **Bathtub thinking**: Stocks integrate flows over time — users cannot expect instant results when a large stock must fill or drain.
- **Stocks as shock absorbers**: Large stocks relative to flows = stability; small stocks = volatility.
- **Both levers exist**: Raising a stock means increasing inflow OR decreasing outflow.

## Anti-patterns

- **Element obsession**: Listing screens or tables without interconnections.
- **Inflow-only thinking**: Ignoring that reducing outflow raises stocks as effectively as increasing inflow.
- **Ignoring stock inertia**: Expecting policy changes to show immediate results.
- **Open chain without feedback**: Some flows are linear, but most product behavior involves feedback.

## Examples

- **Exam hall tickets**: Entities — Student, Exam, Venue, HallTicket. Stock — tickets issued per exam session. Flows — registration (in), cancellation (out). Purpose — assign each student exactly one valid seat for each exam they take.

## Related capabilities

- Dependencies — reachability between features and entity states
- Invariants — rules that must hold across entities
- Feedback Loops — how quantities self-correct or amplify
- Information Architecture — organizing entities for findability
