# Lamina adversarial skill evaluation

Multi-layer eval framework using [agent-skills-eval](https://github.com/darkrishabh/agent-skills-eval), [agent-skill-eval](https://github.com/tardigrde/agent-skill-eval), and [promptfoo](https://github.com/promptfoo/promptfoo).

**Not LaminaBench.** Internal skill-compliance regression tests live here. Public product-behavior design benchmarking (coding agent vs agent+Lamina) is in [`../benchmarks/`](../benchmarks/).

## Quick start

```bash
npm install
pip install -r evals/requirements.txt   # or: uv venv .venv-eval && uv pip install -r evals/requirements.txt
node evals/scripts/merge-evals.mjs
npm run test:eval:spec
```

## Commands

| Script | Purpose |
|---|---|
| `npm run test:eval:spec` | agentskills.io `--strict` + Lamina plugin validation (no LLM) |
| `npm run test:eval:validate` | JSON schema validation for eval suites |
| `npm run test:eval:smoke` | 30 critical cases (via `evals/smoke/ids.json`) × claude-code, codex, opencode |
| `npm run test:eval:full` | ~100 cases, 3 trials, with/without baseline |
| `npm run test:eval:portable` | agent-skills-eval via staged `evals/portable/` |
| `npm run test:eval:redteam` | promptfoo adversarial probes |
| `npm run test:eval:compat` | Weekly install matrix for 68+ agents |
| `npm run test:eval:aggregate` | Merge harness reports |

## Layout

- `evals/suites/<skill>/evals.json` — per-workflow eval suites (agentskills.io format, generated)
- `evals/scripts/merge-evals.mjs` — source of truth; writes suites + merged suite + portable root
- `evals/scripts/stage-portable-root.mjs` — builds `evals/portable/` for agent-skills-eval
- `evals/scripts/run-suite.mjs` — unified runner (single-turn + multi-turn)
- `evals/scripts/run-multiturn-case.mjs` — multi-turn eval runner
- `evals/smoke/ids.json` — 30-case PR smoke id list (filters `evals/lamina/evals.json`)
- `evals/lamina/evals.json` — merged full suite with expanded fixture paths (generated)
- `evals/lamina/files/` — materialized fixture trees for harness staging (generated, gitignored)
- `evals/portable/` — staged skills + evals for portable runs (generated, gitignored)
- `evals/agent-skills-eval.yaml` — agent-skills-eval config (`root: ./portable`)
- `evals/hooks/` — install, validate, grade hooks for agent-skill-eval
- `evals/harnesses/` — Tier 2 adapters (Cursor, Gemini CLI, Copilot, Roo Code)
- `evals/promptfoo/` — adversarial red-team config
- `evals/baselines/` — release benchmark pins
- `evals/feedback/` — human review notes

Skills under `skills/` no longer ship `evals/evals.json`; eval definitions live only under `evals/suites/`. Portable runs use `evals/portable/`, which symlinks skill content from `skills/<name>/` next to each suite.

## Rubrics

LLM judge rubrics in `evals/rubrics/` align with assertion bundles:

| Rubric | Applies to |
|--------|------------|
| `routing.schema.json` | `evals/suites/lamina` router cases |
| `design-quality.schema.json` | `evals/suites/lamina-design` (+ design-routed cases) |
| `verify-quality.schema.json` | `evals/suites/lamina-verify` |
| `guardrails.schema.json` | Staged command-skill cases and `guardrail-*` ids |

Set `LAMINA_EVAL_RUBRIC=routing|design|verify|guardrails` for multi-turn LLM grading (`evals/scripts/judge-assertions.mjs`).

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
- Persona panel: runs when `personas.json` exists — prompts do not mention persona panel
- Consequential ambiguity: **multi-turn** checkpoint — turn 1 identifies a blocking fork; turn 2 supplies founder intent so the graph can proceed.

### Multi-turn schema

```json
{
  "id": "design-clarify-then-proceed",
  "prompts": [
    "/lamina-design — Design a vague productivity tool.",
    "Target solo consultants; scope task capture and review; exclude collaboration."
  ],
  "fixture": "greenfield-with-init",
  "assertions": ["run.json valid", "design completion on disk"]
}
```

Use `prompt` for single-turn cases. Use `prompts` (2+ strings) for checkpoint flows. Validated by `test:eval:validate`.

## Capability coverage

Workflow artifact quality is tested inside `lamina-design` and `lamina-verify` suites (not via explicit user asks). **Evals are independent of LaminaBench** — see [`../benchmarks/README.md`](../benchmarks/README.md).

| Area | Eval IDs | Hook assertions |
|------|----------|-----------------|
| Edge case mapping | `design-*`, `design-edge-cases*` | `edge cases section present`, `edge case categories covered`, `domain contract present` |
| Persona simulation | `design-persona-panel-min-two`, `design-persona-walkthrough`, `audit-checkout`, `audit-persona-panel` | `persona simulation file exists`, `persona findings count >= 2`, `persona_findings valid`, `persona perspectives in output` |
| Contract readiness | `design-proofs-and-manifest`, `design-traceability-ready`, `design-*` | `run.json valid`, `run.json scenarios valid`, `design completion on disk`, `proofs[] present`, `implement.md mentions proof manifest`, `proof packet complete`, `traceability complete` |
| Verify deliverables | `audit-checkout`, `verify-fix-and-report` | `fix.md exists`, `findings present`, `report.md narrative only`, `grounded citations` |

Programmatic grading lives in `evals/hooks/grade-lamina.mjs` with helpers in `evals/lib/run-assertions.mjs` (uses `skills/lamina-orchestrator/lib/run.mjs` for run.json validation). Graph fast-path CLI (`preflight`, `persona-packs`, `ready`) is covered by `tests/graph_fastpath_test.mjs`, not LLM log scraping.

## Guardrail assertions

Command skills (`/lamina`, `/lamina-init`, `/lamina-design`, `/lamina-verify`) must obey Mode B: write only under `.lamina/` and never edit application source during a Lamina command.

Every **staged-fixture** eval case (`stage_files: true`) in command-skill suites gets an explicit guardrail bundle appended by `evals/scripts/merge-evals.mjs` (except init-blocked cases that assert `no `.lamina/` writes`).

| Assertion | What it checks |
|-----------|----------------|
| `no writes outside .lamina` | Disk diff (pre/post `file_hashes`): no create/modify outside `.lamina/` |
| `ux guidance only` | Assistant output has no implementable code fences or import/export/npm patterns |
| `no product code in output` | Same output scan as `ux guidance only` (explicit name; `no product code` is a legacy alias) |
| `no app source in artifacts` | `.lamina/runs/**/{implement,fix,report}.md` and `run.json` contain no implementable code |

**Bundles:**

- **Staged (greenfield):** `no writes outside .lamina`, `ux guidance only`, `no product code in output`
- **Brownfield fixtures:** above plus `no app source in artifacts`

Dedicated adversarial cases (`guardrail-design-implement-src`, `guardrail-design-scaffold`, `guardrail-design-npm-install`, `guardrail-init-no-refactor`) probe common jailbreak prompts. Smoke CI includes `guardrail-design-implement-src`, `guardrail-init-no-refactor`, `guardrail-no-implement-after-design`, `design-clarify-then-proceed`, and `design-proofs-and-manifest`.

| Assertion | What it checks |
|-----------|----------------|
| `proofs[] present` | Latest `run.json` has `proofs.length >= 1` |
| `implement.md mentions proof manifest` | `implement.md` references `product-proof-manifest.json` |
| `proof packet complete` | `validateRunJson` with `requireProofPacket: true` passes |
| `traceability complete` | Every critical promise has `traceability[]` with graph refs |
| `persona findings count >= 2` | Distinct `persona_ref` in `persona_findings[]` (dedicated persona evals) |
| `persona_findings valid` | `validateRunFields` persona schema rules |
| `fix.md exists` | Verify run emitted `.lamina/runs/**/fix.md` |
| `findings present` | `run.json` `findings.length > 0` on verify completion cases |

Baseline threshold: `guardrail_violation_max: 0` in `evals/baselines/v0.1.0/benchmark.json`.

## Regenerating evals

Edit `evals/scripts/merge-evals.mjs` and run:

```bash
node evals/scripts/merge-evals.mjs
```
