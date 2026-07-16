---
name: lamina-verify
description: "Pre-merge verification — walk the live product against design contracts: actor permissions, invariants, reachability, UX flows, accessibility. Use after implementation or for brownfield review before opening a PR."
disable-model-invocation: true
---

# /lamina-verify

## Product

Pre-merge gate: walk the product (live `base_url` or static source) against `run.yaml` contracts — actor permissions, invariants, dependency reachability, UX flows, and accessibility. Always emits `findings[]`, `report.md`, and `fix.md` (ops omitted from the fix brief). Lamina never writes app source and does not run code review.

## Required reads (do this before anything else)

You are already inside this slash skill. **Do not** call `Skill` for `lamina-verify`.

The skill base directory is printed above this body. Resolve paths from that base.

**Your first tool calls must be `Read` on each of these files. Issue them in parallel in one turn when the host allows. Do not Write under `.lamina/` until all of them are read.**

1. `../lamina-orchestrator/load-protocol.md`
2. `../lamina-orchestrator/SKILL.md`
3. `../lamina-orchestrator/workflows/verify.md`
4. `../lamina-orchestrator/artifacts.md`
5. `../lamina-orchestrator/audit-profiles.yaml`
6. `../lamina-orchestrator/prerequisites/init-required.md`
7. `../lamina-orchestrator/prompts/outputs/verify.md`
8. `../lamina-orchestrator/prompts/outputs/fix.md`
9. `../lamina-dependencies/SKILL.md` — reachability probes are first-class

Then follow `workflows/verify.md`. When a section names a profile in `audit-profiles.yaml`, **Read** or Skill-invoke each listed supporting skill before applying that section (actors, integrity, a11y, simulation, synthesis). Supporting skills are model-loadable; this slash skill is not.

**Do not invent artifact paths.** Only `.lamina/runs/<run_id>/` names from `artifacts.md`. Never `verify-report.md` or root-only `findings.md` as substitutes.

**Source is strictly read-only in this command:** missing screens, broken imports, placeholder handlers, and absent behavior become findings. Never create, edit, format, or repair application source while `/lamina-verify` is active, even in an unattended run and even if doing so would unblock a build. The external fix turn exists for that work.

**Disk emission (hard):** `report.md` and `fix.md` must be created with the **Write** tool under `.lamina/runs/<run_id>/`. Pasting their contents into the chat reply (fenced markdown, “Report – …”, “Fix brief – …”) does **not** count — the next coding turn looks for files on disk. After `findings[]` are on `run.yaml`, **Write both files before** any long chat summary. Prefer emitting the files even if a later polish pass would improve wording.

**Finishing sequence:** After probes + `findings[]` on `run.yaml`:
1. `Write` `report.md`
2. `Write` `fix.md` (always — even when Product fixes is `_No product findings._`; still fill Unticked contract checklist)
3. `Bash` existence gate (must exit 0): `test -f .lamina/runs/<run_id>/report.md && test -f .lamina/runs/<run_id>/fix.md`
4. Only then set `status: complete` and emit the verify output contract

**Do not rubber-stamp:** broken imports, missing brief-named flows/screens, placeholder/no-op handlers, type-only rules without enforcement, or missing contracted `screens[]` → product (or contract) findings. Every unticked Must-implement id must be represented by a ticket-shaped finding (related ids may share one finding). Therefore `_No product findings._` and a nonempty Unticked checklist cannot coexist. Empty `findings[]` + “all good” while `App` imports a missing module or product state is only a placeholder is a **failed verify**.

**Independent evidence rule:** Treat application tests as implementation aids, not proof. Trace required behavior through application entrypoints and reachable controls to enforcement, mutation/persistence, actor-scoped projection, and visible outcome. A passing test, named scenario, interface, seed constant, or isolated helper cannot close a checklist row when the production path does not call it. Run the available build/typecheck and record its actual result; never infer buildability from scripts existing in `package.json`.

**Action-inventory runtime rule:** Inventory every reachable mutating route/control and the production service method it invokes. With a deterministic seed or isolated temporary store, exercise at least one authorized path for every mutation family and the brief-critical recovery/denial paths. Any 5xx, `ReferenceError`, undefined symbol/import, unhandled rejection, or action that does not persist and re-project its outcome is a high product finding even when build and agent-authored tests pass. Static-only grounding must still cross-check every referenced runtime symbol/import and record which actions could not be executed.

**Dependency realism rule:** Do not require live vendor credentials when the brief excludes production integration. Require a production-shaped adapter/port and stateful begin→callback/exchange→durable outcome→retry flow with a replaceable local fake. A fixture dropdown wired directly into the main product flow is a finding. Verify that identity is server-bound outside an isolated verification mode, that a credential-free request cannot inherit a privileged session, and that a local auth adapter explicitly establishes or rejects identity.

**Cross-actor + organic-state rule:** For any cross-actor handoff, trace sender action → delivery boundary → recipient open → authenticated recipient binding → accept/reject → durable transition → both projections. A handoff credential stored only in verification fixtures is a high product finding. Exercise ordinary input/delivery paths and confirm they create their own conflict, retry, delivery, or other required recovery records; seeded records alone do not prove the workflow.

**State-integrity rule:** Probe concurrent or stale writes at each consequential shared mutation, verify all affected actor/offline projections refresh after success, and inspect sensitive offline storage claims. Atomic rename without serialization/version checking is not a complete concurrency strategy, and base64/plain local storage must not be described as encrypted.

**Identity + denial-matrix rule:** Attempt to claim another known user using only public identifiers; proof-free identity selection outside verification mode is a high finding. For every mutating route/service method, exercise each role that should be denied—not just one representative read-only action—and confirm unchanged versions/projections. Check actor ownership separately for every actor-scoped status, acknowledgment, completion, and preference transition.

**Organic creation + commit-failure rule:** Starting from the product's normal initial state, create and use every brief-critical record, relationship, and lifecycle variant that the UI advertises; seeded examples alone are insufficient. Inject a persistence failure where feasible and confirm live memory is published only after durable commit; an error response with mutated in-memory state is a high integrity finding.

**Independent build gate:** A greenfield implementation must declare and run a clean build, compile, or typecheck command discoverable by the harness (for Node, normally `package.json#scripts.build`). Runtime smoke and agent-authored tests are supplemental and do not replace this gate.

**Dynamic a11y rule:** Probe focus after navigation/rerender, focus and `aria-describedby` on invalid fields, live announcements for asynchronous results, busy/disabled double-submit protection, and semantic progress/status values. Static labels and CSS target sizes alone do not close accessibility.

**Completion gate:** Do not set `status: complete` and do not end the verify turn until ticket-shaped `findings[]` are on `run.yaml` (may be empty only if probes passed) **and** both `report.md` + `fix.md` exist on disk under `.lamina/runs/<run_id>/`.

**Fix-brief emission:** When writing `fix.md`, follow `prompts/outputs/fix.md` structure. **Never** put Mode B / “do not edit app source” / “Command boundary” / “start a separate coding session” text into `fix.md` — that constraint applies only to **this** `/lamina-verify` command (see Guardrail below). The fix brief is for the implementer and must assume app source will be written.

**Do not** spawn Agent/Task to “run lamina-verify” with a homemade file list. Agent/Task only for persona walks / walkthrough after the files above are loaded.

## Prerequisite

Requires valid `.lamina/business-context.md` from `/lamina-init`. Prefer an existing design run with `status: ready_to_build` or `complete`; brownfield may infer domain from repo + walkthrough.
On failure, emit `../lamina-orchestrator/prompts/outputs/init-blocked.md` verbatim and stop.

## Guardrail

Writes: `.lamina/` only. Repo: read-only. See [guardrails](../lamina-core/guardrails.md).

## Routing

Use for: implementation done; pre-merge product check; brownfield integrity; live/static check against domain, actors, workflows, dependencies, scenarios.

## Subagent hints

- Walkthrough / persona panel / a11y / synthesis — only after Required reads complete; follow paths named in the loaded workflow
- Ops (CI/deploy/push) are non-findings unless the brief requires them
