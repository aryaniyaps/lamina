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

## Proof packet

Load every `proofs[]` entry and the root `product-proof-manifest.json`. For each proof, confirm its mapped files exist, contain the exact `[proof:<id>]` marker, run under the declared test suite, and observe both trusted-boundary state and the user journey. Record a product finding for any missing mapping, stale pre-action assertion, prose-only evidence, unexercised test file, or failed proof. Do not broaden scope during verification; repair the smallest implementation gap that closes the frozen proof.

## Perspective walks

Run `graph-tool.mjs persona-packs` to build ≤3 scoped reviewer payloads. Spawn all packs in **one parallel batch** when the host supports subagents. Follow [the persona panel protocol](../patterns/persona-panel.md), give each only its graph slice and observed product evidence, and isolate reviewer context. Persona preference is not proof; missing reachability, authority, recovery, or accessibility is actionable.

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
