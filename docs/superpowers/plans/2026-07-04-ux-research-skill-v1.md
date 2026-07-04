# Lamina Skills Bundle Plan (Trimmed)

> Execution mode: `superpowers:subagent-driven-development` (preferred) or `superpowers:executing-plans`.

## 1) Scope (explicit)

This plan delivers the **adapter/skills track** of Lamina V1:
- command wrappers (`/lamina*`)
- skills bundle (`skills/*/SKILL.md`)
- `.lamina/*` artifact contract outputs
- MCP/dashboard/docs/test docs for verification
- Skills CLI distribution docs (`npx skills add ...`)

Not in this plan:
- core Lamina CLI/runtime implementation (`lamina start` engine)
- provider analytics connector implementations

## 2) Non-negotiable constraints

- UX-only outputs: no visual styling specs, no product code generation.
- Required checkpoints: framing, synthesis validation, task commit.
- Preserve/reuse existing `.lamina/*` artifacts across sessions.
- Output contract over implementation mechanics (WHAT, not HOW).
- Guardrail line required in commands + skills:
  - **"Do not implement product code; generate UX artifacts/tasks only."**
- If Skills CLI supports an agent, do not maintain agent-specific format trees in-repo.

## 3) Deliverables

Create/modify:

- `commands/lamina.md`
- `commands/lamina-ideate.md`
- `commands/lamina-optimize.md`
- `commands/lamina-feature.md`
- `skills/lamina-core/SKILL.md`
- `skills/lamina-context-discovery/SKILL.md`
- `skills/lamina-research-questions/SKILL.md`
- `skills/lamina-flow-ideate/SKILL.md`
- `skills/lamina-flow-optimize/SKILL.md`
- `skills/lamina-flow-feature/SKILL.md`
- `skills/lamina-synthesis/SKILL.md`
- `skills/lamina-insights/SKILL.md`
- `skills/lamina-personas/SKILL.md`
- `skills/lamina-journeys/SKILL.md`
- `skills/lamina-edge-cases/SKILL.md`
- `skills/lamina-requirements/SKILL.md`
- `skills/lamina-tasks/SKILL.md`
- `skills/lamina-handoff/SKILL.md`
- `skills/lamina-artifacts/SKILL.md`
- `skills/lamina-guardrails/SKILL.md`
- `docs/superpowers/distribution/skills-cli.md`
- `mcp/README.md`
- `mcp/schema.md`
- `dashboard/README.md`
- `dashboard/visual-verification.md`
- `tests/integration/test_flows.md`
- `tests/golden/expected-artifacts.md`
- `tests/fixtures/minimal-nextjs/README.md`
- `tests/fixtures/mobile-app/README.md`
- `scripts/verify_lamina_bundle.mjs`
- `README.md`
- `package.json`
- `docs/superpowers/specs/2026-07-04-lamina-claude-skill-plugin-design.md`

Delete:
- `ux-research-skill/`

## 4) Execution plan (6 chunks)

### Chunk A — Scaffold + safety

- Tag rollback point: `git tag pre-lamina-skill-bundle`
- Delete `ux-research-skill/`
- Ensure dirs exist: `commands/`, `skills/`, `mcp/`, `dashboard/`, `tests/`, `scripts/`
- Add `scripts/verify_lamina_bundle.mjs` with `--check structure|all`

Verify:
- `node scripts/verify_lamina_bundle.mjs --check structure` => `OK`

### Chunk B — Commands + core guardrails/artifacts

- Implement `commands/lamina*.md`
- Implement `lamina-core`, `lamina-guardrails`, `lamina-artifacts`
- Ensure command/skill docs include the mandatory no-code-implementation guardrail sentence.

Verify:
- `node scripts/verify_lamina_bundle.mjs --check all`

### Chunk C — Discovery/flow/synthesis stack

- Implement:
  - context discovery
  - research questions
  - ideate/optimize/feature flows
  - synthesis/insights/personas/journeys

Contract requirements:
- guided + expert mode behavior
- confidence + gaps output
- reuse existing artifacts

Verify:
- verifier passes required flow/synthesis contract checks

### Chunk D — Edge cases/requirements/tasks/handoff

- Implement edge-cases, requirements, tasks, handoff skills

Contract requirements:
- P0/P1/P2 task output
- per-task rationale, acceptance criteria, edge cases, verification, assumptions
- UX Requirements block only (no visual/component instructions)

Verify:
- verifier passes task/handoff contract checks

### Chunk E — Distribution + MCP + dashboard + fixtures

- Add Skills CLI distribution doc
- Add MCP docs with stable JSON shape
- Add dashboard docs as verification-only/non-orchestrator
- Add fixture/golden/integration docs

Distribution doc must include:
- `skills add/list/update/remove`
- project vs global (`-g`)
- symlink vs `--copy`
- CI `-y`
- targeted example (`-a claude-code -a cursor -a codex -a pi`)
- tested Skills CLI version + fallback manual install path

Verify:
- verifier passes docs contract checks

### Chunk F — Top-level docs + metadata + final gate

- Update `README.md` and `package.json`
- Add script: `"verify:bundle": "node scripts/verify_lamina_bundle.mjs --check all"`
- State analytics scope: contract now, provider connectors deferred pending first-iteration validation

Final verify (both required):
- `node scripts/verify_lamina_bundle.mjs --check all`
- `npm run verify:bundle`

## 5) Verifier contract (what to check)

`verify_lamina_bundle.mjs` should check **contracts**, not cosmetic headings:

- Required files exist.
- Commands reference correct core/flow skills.
- Guardrail sentence exists in command + relevant skill docs.
- Required artifact outputs/checkpoints are declared.
- Required task fields are declared (priority/rationale/acceptance/edge/verify/assumptions).
- MCP contract includes keys:
  - `summary`, `artifactsChanged`, `implementationTasksPath`, `nextAction`
- Dashboard docs include both phrases:
  - `verification-only`
  - `not orchestrator`
- Distribution docs include Skills CLI commands + agent-targeted example + fallback guidance.

## 6) Commit strategy (few commits)

1. `refactor: migrate to lamina skills scaffold + node verifier`
2. `feat: add lamina commands and skill modules with ux-only guardrails`
3. `docs: add distribution/mcp/dashboard/tests contracts and finalize metadata`

## 7) Definition of done (for this plan)

Done when:
- all listed files are present and non-empty
- verifier passes (`node ... --check all` + `npm run verify:bundle`)
- guardrails/checkpoints/UX-only boundaries are present in outputs
- `.lamina` artifact reuse is documented
- analytics connectors are explicitly documented as deferred

## 8) Deferred explicitly

- Core Lamina CLI runtime/orchestrator implementation
- Provider analytics connectors (PostHog/Mixpanel/etc.)

These remain separate tracks after validating first iteration of this bundle.
