# dev-review-room — fix

Use the installed Lamina skills and slash commands fully. Follow Mode B: during `/lamina-*` commands write only under `.lamina/`; implement application source in separate coding turns. Do not skip persona-panel native Task children, risk-skill loads, or authority/lifecycle modeling because this is a development pilot — those are part of how Lamina works.

Harden the already-shipped ABI product using the latest design artifacts. Fix authority gaps, edge/recovery paths, and runtime bugs in `app.mjs`/`ui.mjs`. Leave the product runnable. **Do not** rewrite from scratch or invent a parallel `app.js`. **Do not** invoke `/lamina-*` slash commands in this step.

## Required thin-slice ship target

Build a self-contained product in `/app` with no external services. Use plain HTML/CSS/JavaScript and Node ESM so it runs offline.

Required files (these are what the judge scores — do **not** ship a parallel `app.js`):
- `index.html`: minimal UI with a `<main>` landmark and controls for the core flow
- `app.mjs`: exports `createInitialState()`, `reduce(state, action)`, and `project(state, actorId)`
- `ui.mjs` (recommended): browser UI that imports from `app.mjs` — do not put domain rules only in the DOM layer

`reduce()` must be deterministic and side-effect free. **Every published action type must actually mutate domain state** (no silent no-ops). `project()` must return JSON-serializable **actor-scoped** views.

## Product-quality bar (beyond selfcheck)

- Enforce authority and illegal transitions **inside `reduce`** (not only by hiding buttons in the UI).
- Reject unknown ids / empty payloads; do not autovivify phantom domain records.
- Cover failure, empty, and recovery paths that the founder brief implies.
- Prefer durable invariants from design artifacts over comment slogans.

## Published action schema

All arms must implement `reduce(state, action)` accepting these action types:

- `accept_invite`: payload shape example: `{"type":"accept_invite","id":"invite-1","email":"participant@example.org"}`
- `add_comment`: payload shape example: `{"type":"add_comment","id":"c-1","text":"Example note text"}`
- `expire_invite`: payload shape example: `{"type":"expire_invite","id":"invite-1"}`
- `invite`: payload shape example: `{"type":"invite","id":"invite-1","document":"example-document"}`
- `revoke_invite`: payload shape example: `{"type":"revoke_invite","id":"invite-1"}`

`project(state, actorId)` must return JSON-serializable actor-scoped views used by the behavior grader.

Implementation pressure (honest — not graded substrings):
- Lifecycle actions must leave distinct inspectable statuses (open vs completed vs overdue/missed with follow-up).
- Private/sensitive notes must stay distinguishable in the owning actor view.
- Revoke/expire/deny must change the affected actor projection (access ended / denied), not only UI copy.

## Published typed projection contract

The verifier checks the following structured behavior contract. Equivalent values listed here are accepted; arbitrary UI wording is not graded.

```json
{
  "actors": [
    "reviewer",
    "owner"
  ],
  "shape": "{ invites: [{ id, status, access, comments?: [{ id, text }] }] }",
  "typed_equivalents": {
    "granted": [
      "granted",
      "active",
      "accepted"
    ],
    "denied": [
      "denied",
      "expired",
      "revoked",
      false
    ]
  }
}
```

Final scoring uses Harbor RewardKit LLM-as-judge (no hardcoded semantic rubric). Keep the product coherent and runnable.

## Structural self-check (required before finishing this step)

Run `node /app/.lb6-abi/selfcheck.mjs` and fix until it exits 0.

This checks only structural integrity (every published action mutates state; action ids stick; revoke/expire actions change actor projections). It does **not** reveal hidden behavior assertions.

## Founder brief

# Lightweight document review

I want a small product where someone can invite a trusted person to review one document and leave useful comments. It should feel safe and focused rather than like giving away access to a whole workspace. Please shape the product and build the next coherent version.

Do not wait for clarification: this is unattended development-pilot work.
