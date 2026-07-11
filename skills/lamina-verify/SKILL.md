---
name: lamina-verify
description: "Pre-merge verification — walk the live product against design contracts: actor permissions, invariants, reachability, UX flows, accessibility. Use after implementation or for brownfield review before opening a PR."
disable-model-invocation: true
---

# /lamina-verify

## Product

Pre-merge gate: walk the live product against `run.yaml` contracts — actor permissions, invariants, dependency reachability, UX flows, and accessibility. Emits `findings[]`, `report.md`, and `fix.md`. Lamina never writes app source and does not run code review.

## Load

- `../lamina-orchestrator/SKILL.md`
- `../lamina-orchestrator/workflows/verify.md`
- `../lamina-orchestrator/audit-profiles.yaml`
- `../lamina-orchestrator/artifacts.md`
- `../lamina-orchestrator/prerequisites/init-required.md`
- Output contract: `../lamina-orchestrator/prompts/outputs/verify.md`
- Fix brief contract: `../lamina-orchestrator/prompts/outputs/fix.md`
- Blocked output: `../lamina-orchestrator/prompts/outputs/init-blocked.md`

## Prerequisite

Requires valid `.lamina/business-context.md` from `/lamina-init`. Prefer an existing design run with `status: ready_to_build` or `complete` design phase; brownfield may infer domain from repo + walkthrough.

## Guardrail

Writes: `.lamina/` only. Repo: read-only. Never modify app source. See [guardrails](../lamina-core/guardrails.md).

## Routing

Use for: user signals implementation done; pre-merge / pre-PR product check; brownfield integrity check; checking live product against domain, actors, workflows, dependencies, scenarios.

## Subagent hints

- **Visual walkthrough:** capture live product at `base_url` — `../lamina-orchestrator/patterns/visual-walkthrough.md`
- **Actor walks:** one subagent per actor — see [persona-panel](../lamina-orchestrator/patterns/persona-panel.md), [interview-design](../lamina-interview-design/SKILL.md), [usability-evaluation](../lamina-usability-evaluation/SKILL.md)
- **Reachability probes:** load [lamina-dependencies](../lamina-dependencies/SKILL.md) — unmet `domain.dependencies[]` per edge
- **Synthesis:** merge walks into `findings[]` — [research-synthesis](../lamina-research-synthesis/SKILL.md), [research-communication](../lamina-research-communication/SKILL.md)
- **Accessibility:** `../lamina-accessibility/SKILL.md` against captured steps
- **Parallel review:** invariant, reachability, and permission checks inline or parallel when host supports it
