---
description: Design net-new UX — whole product concept or a single feature spec.
disable-model-invocation: true
---

# /lamina-design

## Product

Design net-new UX — from a user problem (whole product concept) or a named capability (feature spec). Auto-routes to concept or feature track.

## Load

- `skills/lamina-orchestrator/SKILL.md`
- `skills/lamina-orchestrator/workflows/design.md`
- `skills/lamina-orchestrator/audit-profiles.yaml`
- `skills/lamina-orchestrator/artifacts.md`
- `skills/lamina-orchestrator/prerequisites/init-required.md`
- Output contracts: `skills/lamina-orchestrator/prompts/outputs/design-concept.md`, `skills/lamina-orchestrator/prompts/outputs/design-feature.md`
- Blocked output: `skills/lamina-orchestrator/prompts/outputs/init-blocked.md`

## Prerequisite

Requires valid `.lamina/business-context.md` from `/lamina-init`. If the init gate fails, emit the `init-blocked` contract **verbatim** from `prompts/outputs/init-blocked.md` and **STOP** — do not proceed with design, do not create artifacts.

## Guardrail

UX artifacts only. Do not implement product code or visual styling specs.

## Track override

Optional: `--track concept` or `--track feature` to force a track.

## Subagent hints

- **Fresh context:** `skills/lamina-orchestrator/agents/research-synthesizer` for large research docs (concept track, step 1)
- **Persona panel:** dynamic spawns — concept track at step 4; feature track after flows; see `skills/lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
- **Parallel review:** `skills/lamina-orchestrator/agents/ux-lens-reviewer` for feature track accessibility + risks
- Default: inline sequential
