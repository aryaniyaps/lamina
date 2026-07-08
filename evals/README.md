# Lamina adversarial skill evaluation

Multi-layer eval framework using [agent-skills-eval](https://github.com/darkrishabh/agent-skills-eval), [agent-skill-eval](https://github.com/tardigrde/agent-skill-eval), and [promptfoo](https://github.com/promptfoo/promptfoo).

**Not LaminaBench.** Internal skill-compliance regression tests live here. Public UX-quality benchmarking (coding agent vs agent+Lamina) is in [`../benchmarks/`](../benchmarks/).

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
| `npm run test:eval:smoke` | 21 critical cases × claude-code, codex, opencode (incl. multi-turn) |
| `npm run test:eval:full` | ~100 cases, 3 trials, with/without baseline |
| `npm run test:eval:portable` | agent-skills-eval portable instruction lift |
| `npm run test:eval:redteam` | promptfoo adversarial probes |
| `npm run test:eval:compat` | Weekly install matrix for 68+ agents |
| `npm run test:eval:aggregate` | Merge harness reports |

## Layout

- `skills/*/evals/evals.json` — per-workflow eval suites (agentskills.io format)
- `skills/lamina-capabilities/evals/evals.json` — direct-mode capability probes
- `evals/scripts/run-suite.mjs` — unified runner (single-turn + multi-turn)
- `evals/scripts/run-multiturn-case.mjs` — multi-turn eval runner
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

## Prompt realism

Workflow evals use **natural user requests** — never telegraph expected workflow steps:

- Feature design: plain feature asks (`Add wishlist`) — edge cases are asserted automatically via `lamina-edge-cases` hooks
- Persona panel: runs when `personas.yaml` exists — prompts do not mention persona panel
- Blueprint / UX Review Studio: **multi-turn** checkpoint — turn 1 is the workflow request; turn 2 is user consent (`Yes, show the wireframe preview.` or `Yes, open UX Review Studio.`)

### Multi-turn schema

```json
{
  "id": "design-blueprint-accept",
  "prompts": [
    "/lamina-design — Add password reset flow.",
    "Yes, show the wireframe preview."
  ],
  "fixture": "greenfield-with-init",
  "assertions": ["blueprint offer made", "blueprint validate passes"]
}
```

Use `prompt` for single-turn cases. Use `prompts` (2+ strings) for checkpoint flows. Validated by `test:eval:validate`.

## Capability coverage

Workflow artifact quality is tested inside `lamina-design` and `lamina-audit` suites (not via explicit user asks):

| Area | Eval IDs | Hook assertions |
|------|----------|-----------------|
| Edge case mapping | `design-*`, `design-edge-cases*` | `edge cases section present`, `edge case categories covered`, `no domain model artifact` |
| Persona simulation | `design-persona-walkthrough`, `audit-checkout`, `audit-persona-panel` | `persona simulation file exists`, `persona perspectives in output` |
| Blueprint checkpoint | `design-blueprint-accept`, `design-blueprint-decline`, `audit-blueprint-accept` | `blueprint offer made`, `blueprint validate passes`, `no blueprint without consent` |
| Flow design (direct) | `cap-flow-design-framework` | `read skill lamina-flow-design` |

Programmatic grading lives in `evals/hooks/grade-lamina.mjs` (uses `lamina-studio validate` for blueprint/scenario checks).

## Regenerating evals

Edit `evals/scripts/merge-evals.mjs` and run:

```bash
node evals/scripts/merge-evals.mjs
```
