---
name: lamina-design
description: "Design how the product works — domain, actors, workflows, dependencies, invariants, UX surfaces — then ready_to_build + implement.md."
disable-model-invocation: true
---

# /lamina-design

## Product

End-to-end product design at the intersection of UX, product rules, and systems thinking. Emits a machine contract, contract-time persona simulation, and stack-agnostic ship-pack `implement.md`. Does not write app source.

## Required reads (do this before anything else)

You are already inside this slash skill. **Do not** call `Skill` for `lamina-design`.

The skill base directory is printed above this body (`Base directory for this skill: …`). Resolve every path below from that base (or its parent `skills/` tree).

**Your first tool calls must be `Read` on each of these files. Issue them in parallel in one turn when the host allows. Do not Write under `.lamina/` until all of them are read.**

1. `../lamina-orchestrator/load-protocol.md`
2. `../lamina-orchestrator/SKILL.md`
3. `../lamina-orchestrator/workflows/design.md`
4. `../lamina-orchestrator/artifacts.md`
5. `../lamina-orchestrator/audit-profiles.yaml`
6. `../lamina-orchestrator/prerequisites/init-required.md`
7. `../lamina-orchestrator/prompts/outputs/design.md`
8. `../lamina-orchestrator/prompts/outputs/implement.md`

Then follow `workflows/design.md`. When a section names a profile in `audit-profiles.yaml`, **Read** (or Skill-invoke) supporting skill `SKILL.md` files **as needed to write that section’s fields** — prefer the one or two most relevant skills; do **not** sequentially pre-read every skill in every profile before drafting.

**Speed / emit-first:** After the required reads above, draft a brief-covering `run.yaml` within the next few tool turns. Before calling it complete, compare the draft directly to the original brief: required domain nouns → entities, rules → invariants/permissions, primary flows → workflows/screens, secondary surfaces → concrete screen behavior, and edge cases → scenarios. Validator success checks schema, not semantic completeness. Iterate with `validate-run` until exit 0, then Write `implement.md` and flip `ready_to_build`. Defer long chat summaries. Skip Agent/Task persona panels when a short inline contract simulation is enough — **disk emission beats elaborate review**. Do not burn the phase re-reading skills after a validating draft exists.

**Executable product bias:** For each primary workflow, design a complete behavior chain: reachable actor action → trusted permission/invariant check → state mutation → durable or explicitly offline-safe state → actor-scoped projection → success/error/recovery feedback. For briefs with shared private data, money, inventory, or other consequential state, client-side hiding alone is not enforcement; require a trusted service/store boundary even when the implementation is a local full-stack fixture. Make negative and recovery states deterministically reachable from seed/reset controls so verify can probe behavior without reading agent-authored tests.

**Multi-actor handoff completion:** When a workflow hands state or authority to another actor, the contract must continue through a named delivery boundary, recipient open/accept/reject, authenticated recipient binding, trusted handoff-state validation, durable relationship or permission change, both actors' projections, expiry/replay handling, and visible completion/recovery. A sender-only artifact, a handoff credential reachable only from verification fixtures, or claiming an already-privileged seed session is not an end-to-end workflow.

**Production-shaped local dependencies:** When real third-party credentials or vendors are unavailable/out of-scope, require a port/adapter boundary with the real workflow shape: begin request, state/nonce, callback or exchange, durable success/failure attempt, retry, and a replaceable local fake behind the adapter. Do not put “success / empty / failure” fixture choices directly in the primary product UI as the integration. Keep verification presets behind an explicit non-product mode. For consequential identity, require server-bound session resolution in a separately auditable module; actor query/header selectors are verification-only, and a request without credentials must never silently inherit a privileged actor. A local identity adapter may be simple, but normal mode must explicitly establish or reject the session.

**Organic edge-state + integrity rule:** Required recovery states must arise from ordinary product paths as well as be probeable by deterministic fixtures: normal inputs create conflict/reconciliation records, handoffs create recipient-reachable delivery records, external failures create retryable attempts, and mutations refresh every affected projection/snapshot. For shared mutable state, specify a concurrency strategy (transaction, compare-and-swap/version, or lock) rather than relying only on atomic file replacement. Describe sensitive offline storage truthfully: encrypt it with a defined key boundary or minimize/label it as plaintext cache; base64 is not encryption.

**Identity, creation, and commit rule:** Consequential identity requires proof of control (password, passkey, or delivered one-time challenge), even behind a local adapter; accepting a public identifier alone is impersonation. Every brief-critical state or lifecycle variant advertised to users needs a normal create/configure path, not only seeded records. Durable transactions must validate the whole cross-record aggregate and publish in-memory state only after persistence succeeds; design a failure-injection scenario proving rejected/failed commits leave both durable and live state unchanged.

**Permission-matrix rule:** Enumerate every consequential mutation against every actor role, not only representative denials. Status, acknowledgment, completion, and preference state must declare whether it is actor-scoped or shared and enforce that ownership explicitly.

**Dynamic accessibility:** Contract navigation focus, form-error focus/association, busy/disabled states, live announcements, and semantic progress/status values—not only labels, target size, and color. Include these in executable chains and expected evidence for each interactive screen.

**Do not invent artifact paths.** Only names in `artifacts.md` (`.lamina/runs/<run_id>/run.yaml`, `implement.md`, …). Never `contract.md`, `persona-simulation.md`, or `.lamina/ready_to_build/`.

**Disk emission (hard):** Design is incomplete until **all** of the following exist on disk under `.lamina/runs/<run_id>/`:
1. `run.yaml` with YAML line `status: ready_to_build` (not `designing`)
2. ship-pack `implement.md` written with the **Write** tool (Must-implement checklist included)
3. `node .claude/skills/lamina-orchestrator/lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml` exited 0 **before** flipping status

Leaving `status: designing` and narrating “will become ready_to_build after validation” (or pasting `implement.md` only in chat) is a **failed design**. Do **not** end the `/lamina-design` turn while status is still `designing` or while `implement.md` is missing on disk. Prefer emitting a complete contract + ship pack over a long chat summary of a draft.

**Completion gate:** Do not set `status: ready_to_build` until validate-run passes (validator ships with the orchestrator skill — use that skill’s `lib/validate-run.mjs` if skills live under another agent dir) and ship-pack `implement.md` exists under `.lamina/runs/<run_id>/`. Do not claim design complete without both.

**Ship-pack emission:** When writing `implement.md`, follow `prompts/outputs/implement.md` structure. **Never** put Mode B / “do not edit app source” / “Command boundary” / “start a separate coding session” text into `implement.md` — that constraint applies only to **this** `/lamina-design` command (see Guardrail below). The ship pack is for the implementer and must assume app source will be written.

**Finishing sequence (after a draft `run.yaml` exists):** Do these tool actions **before** any long chat summary:
1. `Bash`: `node .claude/skills/lamina-orchestrator/lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml` — fix until exit 0
2. `Write`: `.lamina/runs/<run_id>/implement.md` from `prompts/outputs/implement.md`
3. `Edit`/`Write`: set `status: ready_to_build` on that `run.yaml`
4. `Bash` existence gate (must exit 0): `test -f .lamina/runs/<run_id>/implement.md && grep -q '^status:[[:space:]]*ready_to_build' .lamina/runs/<run_id>/run.yaml` — if this fails, return to steps 1–3; **do not** emit the design output contract
5. Only then emit the design output contract (see `prompts/outputs/design.md`)

**Do not** spawn Agent/Task to “run lamina-design” with a homemade file list. Agent/Task only when a **loaded** skill requests persona panel / parallel review.

## Prerequisite

Valid `.lamina/business-context.md` from `/lamina-init`.
On failure, emit `../lamina-orchestrator/prompts/outputs/init-blocked.md` verbatim and stop.

## Guardrail

Writes: `.lamina/` only. Never app source. See [guardrails](../lamina-core/guardrails.md).

## Routing

Improve/fix shipped UI → `/lamina-verify`. After design completes (`ready_to_build` + `implement.md`), a **coding session** (or the host’s next user turn) implements `run.yaml` + `implement.md` end to end — not this slash command — then `/lamina-verify`. See [guardrails](../lamina-core/guardrails.md) agent-primary vs interactive.

## Subagent hints

- **Fresh context:** brownfield — [field-research](../lamina-field-research/SKILL.md)
- **Contract simulation:** [persona-panel](../lamina-orchestrator/patterns/persona-panel.md) after scenarios/UX are drafted
- Validate with `node .claude/skills/lamina-orchestrator/lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml` before `ready_to_build` (validator is under the orchestrator skill `lib/`)
