# control-simple-list — shape and build

Act as a normal coding agent. Before building, use this generic product checklist: identify actors and goals; define the happy path and lifecycle states; define permissions and ownership; consider empty, failure, conflict, boundary, and recovery cases; then implement and self-review. Do not use Lamina skills or slash commands.

## Founder brief

# A tiny household list

I want a pleasant little list for one person to capture a few things, mark them done, and clear completed items. Keep it simple and friendly. Please shape the product and build the next coherent version.


## Required thin-slice ship target

Build a self-contained product in `/app` with no external services. Use plain HTML/CSS/JavaScript and Node ESM so it runs offline.

Required files:
- `index.html`: minimal UI with a `<main>` landmark and controls for the core flow
- `app.mjs`: exports `createInitialState()`, `reduce(state, action)`, and `project(state, actorId)`

`reduce()` must be deterministic and side-effect free. **Every published action type must actually mutate domain state** (no silent no-ops). `project()` must return JSON-serializable **actor-scoped** views (permissions/ownership visible as different projections). Lifecycle actions (complete / miss / handoff / expire / revoke) must leave distinct, inspectable state — not UI-only flags.

## Published action schema

All arms must implement `reduce(state, action)` accepting these action types:

- `add_item`: payload shape example: `{"type":"add_item","id":"item-1","title":"Buy milk"}`
- `complete_item`: payload shape example: `{"type":"complete_item","id":"item-1"}`

`project(state, actorId)` must return JSON-serializable actor-scoped views used by the behavior grader.

Implementation pressure (honest — not graded substrings):
- Lifecycle actions must leave distinct inspectable statuses (open vs completed vs overdue/missed with follow-up).
- Private/sensitive notes must stay distinguishable in the owning actor view.
- Revoke/expire/deny must change the affected actor projection (access ended / denied), not only UI copy.

## Structural self-check (required before finishing this step)

Run `node /tests/selfcheck.mjs` and fix until it exits 0.

This checks only structural integrity (every published action mutates state; action ids stick; revoke/expire actions change actor projections). It does **not** reveal Harbor golden expects. Do not invent static `project()` keyword stubs.

The Harbor behavior grader is the sole scored proof oracle. Do not create `product-proof-manifest.json` unless you choose to; it is not scored.

Do not wait for clarification: this is unattended work. Ship a coherent thin slice, not a broad feature list.
