# pilot-care-circle — shape and build

Act as a normal coding agent using a plan-first workflow. Think through the product, write a short plan, then implement. Do not use Lamina skills or slash commands.

## Founder brief

# Shared care coordination

I want a small product that helps a family coordinate care for an older relative. People should know what was done and what still needs attention without turning the experience into project-management software. Please shape the product and build the next coherent version.


## Required thin-slice ship target

Build a self-contained product in `/app` with no external services. Use plain HTML/CSS/JavaScript and Node ESM so it runs offline.

Required files:
- `index.html`: minimal UI with a `<main>` landmark and controls for the core flow
- `app.mjs`: exports `createInitialState()`, `reduce(state, action)`, and `project(state, actorId)`

`reduce()` must be deterministic and side-effect free. **Every published action type must actually mutate domain state** (no silent no-ops). `project()` must return JSON-serializable **actor-scoped** views (permissions/ownership visible as different projections). Lifecycle actions (complete / miss / handoff / expire / revoke) must leave distinct, inspectable state — not UI-only flags.

## Published action schema

All arms must implement `reduce(state, action)` accepting these action types:

- `add_note`: payload shape example: `{"type":"add_note","id":"n-1","text":"Private note"}`
- `add_task`: payload shape example: `{"type":"add_task","id":"med-1","title":"Morning medication"}`
- `complete_task`: payload shape example: `{"type":"complete_task","id":"med-1"}`
- `mark_missed`: payload shape example: `{"type":"mark_missed","id":"med-1"}`
- `revoke_caregiver`: payload shape example: `{"type":"revoke_caregiver","actor":"revoked-caregiver"}`

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
