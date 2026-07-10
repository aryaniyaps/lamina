# LaminaBench v2.0

**Public product-behavior design benchmark** comparing the same coding agent with and without Lamina.

This directory is **not** [`evals/`](../evals/). Those are internal skill-compliance regression tests (routing, init gates, guardrails). LaminaBench measures whether Lamina improves **product design contract quality** — domain rules, workflows, scenarios, and edge behavior — on realistic tasks.

> **Status (v2.0.0):** Corpus and scoring pipeline are claim-hardened. **No live results are published yet.** Do not cite performance numbers externally until a live `npm run bench:all` run is committed under `releases/v2.0.0/`.

## What is compared

| Arm | Description |
|-----|-------------|
| **Control** | Coding agent only — same model, prompt, fixture, no Lamina |
| **Treatment** | Same agent + Lamina skills installed |

The only independent variable is Lamina. Both arms receive the same natural-language task plus a shared **product-behavior output contract** (domain, illegal states, actors, workflows, scenarios, trade-offs, implementation brief). No forced `/lamina-design`.

## Quick start

```bash
npm install
# Live release path (requires agent CLI + API keys for LLM judge)
npm run bench:validate
npm run bench:all

# Pipeline check only (mock artifacts — NOT for claims)
npm run bench:pipeline-check
```

## Commands

| Script | Purpose |
|--------|---------|
| `npm run bench:validate` | Validate task + golden schemas and fixtures |
| `npm run bench:run` | Live control/treatment runs (requires agent CLI) |
| `npm run bench:run:mock` | Synthetic equal-coverage artifacts for pipeline checks |
| `npm run bench:score` | Golden coverage + LLM judge (promptfoo when keys set) |
| `npm run bench:score:heuristic` | Coverage + arm-neutral heuristic judge |
| `npm run bench:analyze` | Stats + composite 40/40/20 → `results/report.md` |
| `npm run bench:human-packet` | Blind human review packet (no synthetic scores) |
| `npm run bench:import-human` | Import real rater CSV → `human-scores.json` |
| `npm run bench:all` | **Live** validate → run → score → analyze → human-packet |
| `npm run bench:pipeline-check` | Mock path for CI/pipeline validation only |

## Layout

```
benchmarks/
  release.yaml          # Pinned agent, model, run parameters, weights
  tasks/taskNNN/        # description.md, context.md, task.yaml
  goldens/taskNNN/      # reference checklist (not ground truth)
  fixtures/             # Manifests; Plane/Outline are context stubs
  judges/               # Rubric, golden-coverage, promptfoo config
  scripts/              # Runner, compiler, analysis, human import
  results/              # Raw runs, scores, statistics (gitignored)
  releases/             # Committed snapshots only when claim-ready
```

## Corpus (v2.0)

25 tasks across 5 categories (5 each):

1. Greenfield product design
2. OSS feature design (Commerce = vendored code; Plane/Outline = **product-context stubs**)
3. OSS behavior audit (same fixture honesty as above)
4. Workflow and edge-case design
5. Resilience and degraded states

3 runs per arm × 25 tasks = 150 agent executions. Human blind eval on a 10-task stratified subset.

## Scoring

| Layer | Weight | Method |
|-------|--------|--------|
| Golden coverage | 40% | Phrase match vs reference checklist (invariants/scenarios/entities/trade-offs 2×). **Sections not scored** (format-neutral). |
| LLM judge | 40% | 2-model promptfoo rubric when API keys set; otherwise arm-neutral heuristic (disclosed, not claim-ready alone) |
| Human eval | 20% | Blind raters on 10-task subset via CSV import (`bench:import-human`) |

`analyze.py` computes a **composite** on a 1–5 scale from available layers (renormalizes if human subset is absent). Reports mark `claim_ready: false` when any run is mock, judge is heuristic-only, or human scores are synthetic.

Goldens are a **reference checklist**, not ground truth — any clear wording of the concept counts.

### What this does *not* measure

- Live product verify / persona-walk outcomes (see secondary metric below)
- Implementation correctness of shipped code
- Model independence (default pin: `claude-code` + Sonnet 4; multi-agent pilots via `--agent`)
- WCAG certification
- Lamina workflow compliance (`evals/`)

## Secondary metric (usefulness path)

Contract quality is necessary but not sufficient for the product promise. Optional follow-on:

```bash
node benchmarks/scripts/secondary-verify-metric.mjs --help
```

After both arms produce a brief, the same coding agent implements a thin slice; score verify/persona-walk findings or invariant checks. Document results separately from the primary contract A/B.

## Reproducing a release

1. Set API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
2. Install reference agent: `claude` CLI (see `release.yaml`)
3. `npm run bench:all` (live — never `--mock`)
4. Run blind human review; `npm run bench:import-human -- --csv scores.csv`
5. Re-run `npm run bench:analyze`
6. Copy `results/report.md` + `results/statistics/stats.json` to `releases/v2.0.0/` only if `claim_ready: true`

**v1.1.0 mock results are retired** — do not use for external claims.

## Claim wording (use only after claim_ready)

> On a public 25-task product-behavior design benchmark spanning greenfield design, OSS feature design, OSS behavior audits, workflow edge cases, and resilience challenges, the same coding agent with Lamina produced higher-quality product design briefs than the agent alone — measured by reference-checklist coverage (domain invariants, scenarios, workflows), multi-judge rubric scores, and blind human evaluation on a 10-task stratified subset. Results are pinned to the agent/model in `release.yaml` and do not claim live verify outcomes or model independence.

Until live results exist, prefer:

> LaminaBench v2.0 defines a public A/B protocol for product-behavior design brief quality. Live results are not yet published.

## Fixture honesty

| Fixture | Realism |
|---------|---------|
| `commerce-*` | Full vendored Vercel Commerce codebase |
| `plane-with-init` | **Stub** — product description + business context, not a full Plane clone |
| `outline-with-init` | **Stub** — product description + business context, not a full Outline clone |
