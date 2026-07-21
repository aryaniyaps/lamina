# pilot-care-circle — lamina verify

Use the installed Lamina skills and slash commands fully. Follow Mode B: during `/lamina-*` commands write only under `.lamina/`; implement application source in separate coding turns. Do not skip persona-panel subagents, UI walkthrough capture, risk-skill loads, or authority/lifecycle modeling because this is a benchmark — those are part of how Lamina works.

Run **only** `/lamina-verify` via the `lamina-verify` skill end-to-end.

Required verify procedure (do not skip):
1. Load `run.json`, set `status: verifying`.
2. Start a local server for `/app` and capture a **live UI walkthrough** into `.lamina/runs/<run_id>/walkthrough/` (follow `visual-walkthrough.md`; use Chromium at `/usr/bin/chromium` or host browser tools).
3. Spawn **≥2 isolated persona-panel subagents** (Task/Agent tool) using `persona-panel-spawn.md` — one materially distinct persona each; do not inline-fake the panel in the parent turn when subagents are available.
4. Merge structural persona results into `persona_findings[]`, write ticket-shaped `findings[]`, `report.md`, and `fix.md`.
5. Leave application source read-only; write only under `.lamina/`.

## Lamina bench profile (required)

- Contract stage: start from **`shape`**. Follow `/lamina-design` stage rules — apply harden-level rigor at in-scope authority, privacy, and lifecycle boundaries without expanding into production auth/infra.
- Delivery posture: in-memory reducer + HTML UI in `/app` (no OAuth, CSRF productization, or server-clock infrastructure). **Still model** actor authority, revoke/deny, private vs shared projections, and lifecycle transitions as first-class `reduce`/`project` behavior — do not drop them because the delivery is a prototype.
- `proof_budget`: use normal design ceilings (≤3 critical promises, ≤10 operations, ≤6 workflows, ≤12 proofs). Budget must cover **every published action type** and each critical multi-actor path; do not shrink below that to look “minimal.”
- Design must run the persona-panel (isolated subagents when available) before `ready_to_build`, and `implement.md` must include acceptance for: each published action mutates state; actor-scoped projections; revoke/expire/deny paths when those actions exist.
- Load supporting skills from `audit-profiles.yaml` when risk signals fire (multi-actor, trust, accessibility, time, empty/error, concurrency). Do not skip required risk skills to keep context small.
- Verify (required full audit — live UI + persona panel):
  1. Serve the product (`index.html` + `app.mjs`) on localhost (e.g. `python3 -m http.server 8765` in `/app`)
  2. Run a **UI / visual walkthrough** per `lamina-orchestrator/patterns/visual-walkthrough.md` — write `.lamina/runs/<run>/walkthrough/` (`index.yaml` with `mode: live_app`, `source: product`, plus step screenshots and/or `.a11y.json` dumps). Chromium is at `/usr/bin/chromium`.
  3. Spawn **isolated persona-panel subagents** (≥2 distinct personas) per `patterns/persona-panel.md` + `prompts/subagents/persona-panel-spawn.md`; merge into `persona_findings[]` (`source: persona_hypothesis`). The agent owns spawning — the Harbor harness does not spawn reviewers for you.
  4. Prioritize findings about missing lifecycle transitions, authority changes, and actor-view divergence; still write `findings[]`, `report.md`, and `fix.md`
- Mode B: during `/lamina-*` write only `.lamina/`; implement or fix app source in the next coding turn. You may Read skills and `.lamina/` freely in coding turns.
- Harbor golden sequences are the scored proof oracle. `product-proof-manifest.json` is optional and unscored — do not burn the step trying to satisfy unmarked suite markers.


## Founder brief

# Shared care coordination

I want a small product that helps a family coordinate care for an older relative. People should know what was done and what still needs attention without turning the experience into project-management software. Please shape the product and build the next coherent version.


