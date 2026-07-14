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

**Your first tool calls must be `Read` on each of these files, in order. Do not Write under `.lamina/` until all of them are read.**

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

**Completion gate:** Do not set `status: complete` until ticket-shaped `findings[]` are written (may be empty only if probes passed) and both `report.md` + `fix.md` exist under `.lamina/runs/<run_id>/`.

**Do not** spawn Agent/Task to “run lamina-verify” with a homemade file list. Agent/Task only for persona walks / walkthrough after the files above are loaded.

## Prerequisite

Requires valid `.lamina/business-context.md` from `/lamina-init`. Prefer an existing design run with `status: ready_to_build` or `complete`; brownfield may infer domain from repo + walkthrough.

## Guardrail

Writes: `.lamina/` only. Repo: read-only. See [guardrails](../lamina-core/guardrails.md).

## Routing

Use for: implementation done; pre-merge product check; brownfield integrity; live/static check against domain, actors, workflows, dependencies, scenarios.

## Subagent hints

- Walkthrough / persona panel / a11y / synthesis — only after Required reads complete; follow paths named in the loaded workflow
- Ops (CI/deploy/push) are non-findings unless the brief requires them
