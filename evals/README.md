# Lamina adversarial skill evaluation

Multi-layer eval framework using [agent-skills-eval](https://github.com/darkrishabh/agent-skills-eval), [agent-skill-eval](https://github.com/tardigrde/agent-skill-eval), and [promptfoo](https://github.com/promptfoo/promptfoo).

## Quick start

```bash
npm install
pip install -r evals/requirements.txt
node evals/scripts/merge-evals.mjs
npm run test:eval:spec
```

## Commands

| Script | Purpose |
|---|---|
| `npm run test:eval:spec` | agentskills.io `--strict` + Lamina plugin validation (no LLM) |
| `npm run test:eval:validate` | JSON schema validation for eval suites |
| `npm run test:eval:smoke` | 21 critical cases × claude-code, codex, opencode |
| `npm run test:eval:full` | ~105 cases, 3 trials, with/without baseline |
| `npm run test:eval:portable` | agent-skills-eval portable instruction lift |
| `npm run test:eval:redteam` | promptfoo adversarial probes |
| `npm run test:eval:compat` | Weekly install matrix for 68+ agents |
| `npm run test:eval:aggregate` | Merge harness reports |

## Layout

- `skills/*/evals/evals.json` — per-workflow eval suites (agentskills.io format)
- `skills/lamina-capabilities/evals/evals.json` — edge cases, persona simulation, blueprint creation
- `evals/smoke/evals.json` — 21-case PR smoke subset
- `evals/lamina/evals.json` — merged full suite (generated)
- `evals/hooks/` — install, validate, grade hooks for agent-skill-eval
- `evals/harnesses/` — Tier 2 adapters (Cursor, Gemini CLI, Copilot, Roo Code)
- `evals/promptfoo/` — adversarial red-team config
- `evals/baselines/` — release benchmark pins
- `evals/feedback/` — human review notes

## Harness tiers

1. **Tier 1** — agent-skill-eval native: `claude-code`, `codex`, `opencode`
2. **Tier 2** — custom adapters in `evals/harnesses/`
3. **Tier 3** — portable `agent-skills-eval` (model + skill injection)
4. **Tier 4** — `npm run test:eval:compat` install matrix

## CI

- **PR:** `eval-spec.yml` — unit tests + strict + schema validate
- **PR (label `run-eval-smoke`):** `eval-smoke.yml`
- **Nightly:** `eval-nightly.yml` — full harness + portable
- **Weekly:** `eval-weekly.yml` — compat matrix + promptfoo redteam

## Capability coverage

The `lamina-capabilities` suite tests UX artifact quality beyond routing/guardrails:

| Area | Eval IDs | Hook assertions |
|------|----------|-----------------|
| Edge case mapping | `cap-edge-cases-*`, `design-feature-edge-cases*` | `edge case categories covered`, `no domain model artifact`, `no implementation vocabulary` |
| Persona simulation | `cap-persona-*`, `design-concept-persona-walkthrough`, `audit-persona-panel` | `persona simulation file exists`, `persona perspectives in output` |
| Blueprint creation | `cap-blueprint-*`, `design-feature-blueprint-checkpoint` | `blueprint validate passes`, `scenarios.yaml valid`, `no styling in blueprint` |
| Flow design | `cap-flow-design-framework` | `read skill lamina-flow-design` |

Programmatic grading lives in `evals/hooks/grade-lamina.mjs` (uses `lamina-blueprint validate` for blueprint/scenario checks).

## Regenerating evals

Edit `evals/scripts/merge-evals.mjs` and run:

```bash
node evals/scripts/merge-evals.mjs
```
