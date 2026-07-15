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
