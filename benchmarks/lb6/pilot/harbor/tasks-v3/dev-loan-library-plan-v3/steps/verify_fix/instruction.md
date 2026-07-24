# dev-loan-library — verify and fix

The host supervisor has sealed the shaping snapshot. Implement the newly injected public ABI, self-review behavior against the founder brief, and leave the product runnable.

## Required thin-slice ship target

Build a self-contained product in `/app` with no external services. Use plain HTML/CSS/JavaScript and Node ESM so it runs offline.

Required files:
- `index.html`: minimal UI with a `<main>` landmark and controls for the core flow
- `app.mjs`: exports `createInitialState()`, `reduce(state, action)`, and `project(state, actorId)`

`reduce()` must be deterministic and side-effect free. **Every published action type must actually mutate domain state** (no silent no-ops). `project()` must return JSON-serializable **actor-scoped** views.

## Published action schema

All arms must implement `reduce(state, action)` accepting these action types:

- `confirm_handoff`: payload shape example: `{"type":"confirm_handoff","id":"loan-1","actor":"borrower"}`
- `report_damage`: payload shape example: `{"type":"report_damage","id":"loan-1"}`
- `request_loan`: payload shape example: `{"type":"request_loan","id":"loan-1","item":"Example item"}`

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
    "borrower",
    "owner"
  ],
  "shape": "{ loans: [{ id, status, handoff?: { borrower, owner }, borrowerConfirmed?, ownerConfirmed?, damageReported?, lendingPaused: boolean }] }; `canLend: boolean` is an accepted inverse capability; damage is accepted only after both handoff confirmations, then future lending is explicitly paused",
  "typed_equivalents": {
    "requested": [
      "requested",
      "pending",
      "open"
    ],
    "active": [
      "active"
    ],
    "damaged": [
      "damaged",
      "damage_reported",
      "damage_review",
      "dispute"
    ],
    "boolean_true": [
      true,
      "true",
      "yes",
      "confirmed"
    ]
  }
}
```

The behavior rubric has ten equal semantic points. Valid rewards use arm-blind Laplace smoothing: `(earned + 1) / 12`; raw earned/10 is also reported. Deterministic replay is an eligibility gate.

## Structural self-check (required before finishing this step)

Run `node /app/.lb6-abi/selfcheck.mjs` and fix until it exits 0.

This checks only structural integrity (every published action mutates state; action ids stick; revoke/expire actions change actor projections). It does **not** reveal hidden behavior assertions.

## Founder brief

# Borrowing things among neighbors

I want a friendly way for a small neighborhood group to lend useful things to one another. People should know who has what and whether it is safe to lend again, without making it feel like a logistics system. Please shape the product and build the next coherent version.

Do not expand scope. Prefer fixing incorrect state, authority, lifecycle, and recovery behavior.
