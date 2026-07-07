# LaminaBench v1.1

**Public UX-quality benchmark** comparing the same coding agent with and without Lamina.

This directory is **not** [`evals/`](../evals/). Those are internal skill-compliance regression tests (routing, init gates, guardrails). LaminaBench measures whether Lamina improves UX artifact quality on realistic tasks.

## What is compared

| Arm | Description |
|-----|-------------|
| **Control** | Coding agent only — same model, prompt, fixture, no Lamina |
| **Treatment** | Same agent + Lamina skills installed |

The only independent variable is Lamina.

## Quick start

```bash
npm install
pip install -r benchmarks/requirements.txt
npm run bench:validate
make -C benchmarks bench:all    # validate → run → score → analyze
```

## Commands

| Script | Purpose |
|--------|---------|
| `npm run bench:validate` | Validate task + golden schemas and fixtures |
| `npm run bench:run` | Execute control/treatment runs (requires agent CLI) |
| `npm run bench:score` | Golden coverage + LLM judge scoring |
| `npm run bench:analyze` | Statistical analysis → `results/report.md` |
| `npm run bench:human-packet` | Generate blind human review packet |

## Layout

```
benchmarks/
  release.yaml          # Pinned agent, model, run parameters
  tasks/taskNNN/        # description.md, context.md, task.yaml
  goldens/taskNNN/      # golden.yaml (evaluation reference)
  fixtures/             # Benchmark fixture manifests (may reference evals/fixtures)
  judges/               # Rubric, golden-coverage scorer, promptfoo config
  scripts/              # Runner, compiler, analysis
  results/              # Raw runs, scores, statistics (gitignored except releases)
```

## Corpus (v1.1)

25 tasks across 5 categories (5 each):

1. Greenfield product design
2. OSS feature design (Commerce, Plane, Outline)
3. OSS UX audit
4. Workflow and edge-case design
5. Accessibility and resilience

3 runs per arm × 25 tasks = 150 agent executions. Human blind eval on a 10-task stratified subset.

## Scoring

| Layer | Weight | Method |
|-------|--------|--------|
| Golden coverage | 40% | Objective checklist vs `goldens/*/golden.yaml` |
| LLM judge | 40% | 2-model promptfoo rubric |
| Human eval | 20% | Blind raters on 10-task subset |

## Reproducing a release

1. Set API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
2. Install reference agent: `claude` CLI (see `release.yaml`)
3. `npm run bench:validate && npm run bench:run`
4. `npm run bench:score && npm run bench:analyze`
5. Compare output to tagged `bench-v1.1.0` results

## Claim wording

> On a public 25-task UX reasoning benchmark spanning greenfield design, OSS feature design, OSS UX audits, workflow edge cases, and accessibility challenges, the same coding agent with Lamina produced higher-quality UX artifacts than the agent alone, measured by golden-spec coverage and multi-judge rubric scores, with blind human evaluation confirming the trend on a 10-task stratified subset.

LaminaBench does **not** claim deterministic outputs, model independence, or WCAG certification.
