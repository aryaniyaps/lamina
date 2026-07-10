---
name: lamina-verify
description: "Verify built product against design contracts — actor walks, invariants, accessibility, and integrity on live UI. Use after implementation or for brownfield review."
disable-model-invocation: true
---

# /lamina-verify

## Product

Post-build verification: walk the live product against `run.yaml` contracts — actor permissions, invariants, UX flows, and accessibility. Emits `findings[]`, `report.md`, and `fix.md`. Lamina never writes app source.

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

Use for: user signals implementation done; brownfield integrity check; checking live product against domain, actors, workflows, scenarios.

## Subagent hints

- **Visual walkthrough:** capture live product at `base_url` — `../lamina-orchestrator/patterns/visual-walkthrough.md`
- **Actor walks:** one subagent per actor — see [persona-panel](../lamina-orchestrator/patterns/persona-panel.md), [interview-design](../lamina-interview-design/SKILL.md), [usability-evaluation](../lamina-usability-evaluation/SKILL.md)
- **Synthesis:** merge walks into `findings[]` — [research-synthesis](../lamina-research-synthesis/SKILL.md), [research-communication](../lamina-research-communication/SKILL.md)
- **Accessibility:** `../lamina-accessibility/SKILL.md` against captured steps
- **Parallel review:** invariant and permission checks inline or parallel when host supports it
