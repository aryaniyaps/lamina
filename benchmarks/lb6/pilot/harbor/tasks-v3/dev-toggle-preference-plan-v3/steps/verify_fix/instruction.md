# dev-toggle-preference — verify and fix

The host supervisor has sealed the shaping snapshot. Implement the newly injected public ABI, self-review behavior against the founder brief, and leave the product runnable.

## Required thin-slice ship target

Build a self-contained product in `/app` with no external services. Use plain HTML/CSS/JavaScript and Node ESM so it runs offline.

Required files:
- `index.html`: minimal UI with a `<main>` landmark and controls for the core flow
- `app.mjs`: exports `createInitialState()`, `reduce(state, action)`, and `project(state, actorId)`

`reduce()` must be deterministic and side-effect free. **Every published action type must actually mutate domain state** (no silent no-ops). `project()` must return JSON-serializable **actor-scoped** views.

## Published action schema

All arms must implement `reduce(state, action)` accepting these action types:

- `disable_focus_mode`: payload shape example: `{"type":"disable_focus_mode","id":"pref-1"}`
- `enable_focus_mode`: payload shape example: `{"type":"enable_focus_mode","id":"pref-1"}`
- `toggle_focus_mode`: payload shape example: `{"type":"toggle_focus_mode","id":"pref-toggle"}`

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
    "user"
  ],
  "shape": "{ preferences: [{ id, focusEnabled: boolean }] }",
  "typed_equivalents": {
    "enabled": [
      true,
      "enabled",
      "on"
    ],
    "disabled": [
      false,
      "disabled",
      "off"
    ]
  },
  "unknown_actions": "must be ignored without exposing their payload"
}
```

The behavior rubric has ten equal semantic points. Valid rewards use arm-blind Laplace smoothing: `(earned + 1) / 12`; raw earned/10 is also reported. Deterministic replay is an eligibility gate.

## Structural self-check (required before finishing this step)

Run `node /app/.lb6-abi/selfcheck.mjs` and fix until it exits 0.

This checks only structural integrity (every published action mutates state; action ids stick; revoke/expire actions change actor projections). It does **not** reveal hidden behavior assertions.

## Founder brief

# Focus mode

I want a minimal personal settings panel where I can turn focus mode on when I need fewer distractions, see that the app reflects that choice, and turn it off again when I'm done. One person, one simple preference — keep the implementation small.

Do not expand scope. Prefer fixing incorrect state, authority, lifecycle, and recovery behavior.
