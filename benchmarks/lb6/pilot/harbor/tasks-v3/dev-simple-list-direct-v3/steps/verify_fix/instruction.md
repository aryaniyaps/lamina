# dev-simple-list — verify and fix

The host supervisor has sealed the shaping snapshot. Implement the newly injected public ABI, self-review behavior against the founder brief, and leave the product runnable.

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

- `add_item`: payload shape example: `{"type":"add_item","id":"item-1","title":"Example title"}`
- `clear_completed`: payload shape example: `{"type":"clear_completed"}`
- `complete_item`: payload shape example: `{"type":"complete_item","id":"item-1"}`

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
    "owner"
  ],
  "shape": "{ items: [{ id, title, completed: boolean, status?: 'open'|'completed' }] }; clear_completed removes completed items and retains open items",
  "typed_equivalents": {
    "complete": [
      true,
      "completed",
      "done"
    ],
    "incomplete": [
      false,
      "open",
      "pending"
    ]
  }
}
```

Final scoring uses Harbor RewardKit LLM-as-judge (no hardcoded semantic rubric). Keep the product coherent and runnable.

## Structural self-check (required before finishing this step)

Run `node /app/.lb6-abi/selfcheck.mjs` and fix until it exits 0.

This checks only structural integrity (every published action mutates state; action ids stick; revoke/expire actions change actor projections). It does **not** reveal hidden behavior assertions.

## Founder brief

# A tiny household list

I want a pleasant little list for one person to capture a few things, mark them done, and clear completed items. Keep it simple and friendly. Please shape the product and build the next coherent version.

Do not expand scope. Prefer fixing incorrect state, authority, lifecycle, and recovery behavior.
