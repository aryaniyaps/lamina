---
name: lamina-design
description: "Design net-new UX — whole product concept or a single feature spec."
disable-model-invocation: true
---

# /lamina-design

## Product

Design net-new UX — from a user problem (whole product concept) or a named capability (feature spec). Auto-routes to concept or feature track.

## Load

- `../lamina-orchestrator/SKILL.md`
- `../lamina-orchestrator/workflows/design.md`
- `../lamina-orchestrator/audit-profiles.yaml`
- `../lamina-orchestrator/artifacts.md`
- `../lamina-orchestrator/prerequisites/init-required.md`
- Output contracts: `../lamina-orchestrator/prompts/outputs/design-concept.md`, `../lamina-orchestrator/prompts/outputs/design-feature.md`
- Blocked output: `../lamina-orchestrator/prompts/outputs/init-blocked.md`

## Prerequisite

Requires valid `.lamina/business-context.md` from `/lamina-init`. If the init gate fails, emit the `init-blocked` contract **verbatim** from `../lamina-orchestrator/prompts/outputs/init-blocked.md` and **STOP** — do not proceed with design, do not create artifacts.

## Guardrail

UX artifacts only. Do not implement product code or visual styling specs.

## Track override

Optional: `--track concept` or `--track feature` to force a track.

## Subagent hints

- **Fresh context:** `../lamina-orchestrator/agents/research-synthesizer` for large research docs (concept track, step 1)
- **Persona panel:** dynamic spawns — concept track at step 4; feature track after flows; see `../lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
- **Parallel review:** `../lamina-orchestrator/agents/ux-lens-reviewer` for feature track accessibility + risks
- Default: inline sequential
