# Product graph verification

## Grounding

Load a ready design graph or create a brownfield verification graph. Prefer live product evidence; static source is acceptable when no runnable surface exists. Record the grounding mode and actual build/test results.

## Critical path trace

For every critical workflow, trace:

1. Reachable actor action.
2. Trusted authority and invariant enforcement.
3. Valid state transition.
4. Durable commit.
5. Correct actor-scoped projection.
6. Visible terminal outcome or recovery.

Probe graph scenarios and distinct risks, including unmet dependencies, forbidden roles, stale or concurrent writes, destructive actions, external failure, and replay when relevant.

## Perspective walks

Use at most three evidence-grounded persona perspectives with materially different authority or constraints. Follow [the persona panel protocol](../patterns/persona-panel.md), give each only its graph slice and observed product evidence, and isolate reviewer context. Persona preference is not proof; missing reachability, authority, recovery, or accessibility is actionable.

## Contract drift

Create a contract finding when the implementation reveals intended behavior missing or contradicted in `run.json`. Create a product finding when implementation fails the valid contract. Do not silently edit one to excuse the other.

## Findings

Each non-ops finding contains:

- Stable id and severity.
- `fix_target: product | contract`.
- Graph references.
- Concrete source or walkthrough evidence.
- Observable acceptance criteria.

Ops-only findings stay in the report. Always write `report.md` and `fix.md`, even when no product fixes remain.
