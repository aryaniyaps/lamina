# LaminaBench v2.0

**Public product-behavior implementation benchmark** comparing the same coding agent with and without Lamina.

This directory is **not** [`evals/`](../evals/). Those are internal skill-compliance regression tests (routing, init gates, guardrails). LaminaBench measures whether Lamina improves **implemented product behavior** — domain rules, workflows, scenarios, and edge handling **in code** — on realistic tasks.

> **Status (v2.0.0):** Corpus and scoring pipeline are claim-hardened. **No live results are published yet.** Do not cite performance numbers externally until a live `npm run bench:all` run is committed under `releases/v2.0.0/`.

**Methodology:** [Design A — ecological adoption comparison](METHODOLOGY.md) (`design_a_ecological`). Control = Plan + implement (2 turns). Treatment = full Lamina loop (5 turns). **Unequal turns are intentional** — see [why this is the right design](METHODOLOGY.md#why-unequal-turns-is-the-right-design-not-a-loophole), not a scoring loophole.

## What is compared

| Arm | Description |
|-----|-------------|
| **Control** | Plan mode → implement — same agent/model/fixture, **no Lamina** ([hotel demo baseline](../demo/)) |
| **Treatment** | Full Lamina loop — same agent/model/fixture + Lamina skills |

The comparison is **adoption-shaped**: realistic without-Lamina practice vs adopting Lamina. It is **not** a matched-turn ablation where control manually copies Lamina’s verify/fix loop.

## Workflow (live runs)

| Phase | Control (Plan mode, no Lamina) | Treatment (Lamina installed) |
|-------|-------------------------------|------------------------------|
| 1 | Write `bench-plan.md` (implementation plan) | `/lamina-init` establish or update |
| 2 | Implement minimal vertical slice | `/lamina-design` or `/lamina-verify` (audit tasks) |
| 3 | — | Implement from contract |
| 4 | — | `/lamina-verify` post-build |
| 5 | — | Fix issues from `fix.md` (falls back to verify report) |

**2 turns (control)** vs **5 turns (treatment)** — [documented methodology](METHODOLOGY.md), not matched compute.

**Scoring** captures **application source** (see [methodology.json](methodology.json)):
- **Control**: after phase 2 (post-implement) — no verify/fix loop
- **Treatment**: after phase 5 (post-fix)

`.lamina/` files and `bench-plan.md` are excluded from scored artifacts.

## Methodology (why Design A)

Full rationale: **[METHODOLOGY.md](METHODOLOGY.md)**

| Principle | What we do |
|-----------|------------|
| **Ecological validity** | Control matches Plan + implement — what teams do without Lamina |
| **Product-complete treatment** | Treatment runs through verify → fix because that is Lamina’s loop |
| **No borrowed methodology** | Control does **not** run Lamina’s verify/fix phases — that would be Lamina’s process without Lamina’s name |
| **Honest stopping points** | Control scored post-implement; treatment post-fix — each at its natural finish |
| **Transparent claims** | Every `report.md` includes methodology; `claim_ready` requires live runs |

**Rejected alternative:** matched 5-phase control (manual copy of Lamina’s loop) — valid ablation, wrong question for this benchmark. See [rejected alternatives](METHODOLOGY.md#4-what-we-rejected-and-why).

### Constraints we enforce

- **Same agent, model, task, and fixture** per run
- **No Lamina skills on control**
- **Same scored artifact type**: product source (process files excluded)
- **Audit tasks**: treatment uses brownfield `/lamina-verify` + post-implement verify; control plans fixes in `bench-plan.md` then implements

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
| `npm run bench:import-google-form` | Import Google Form / Sheets CSV + verification audit |
| `npm run bench:all` | **Live** validate → run → score → analyze → human-packet |
| `npm run bench:pipeline-check` | Mock path for CI/pipeline validation only |

## Layout

```
benchmarks/
  METHODOLOGY.md        # Design A rationale (ecological adoption — required reading)
  methodology.json      # Machine-readable methodology pin for reports
  release.yaml          # Pinned agent, model, run parameters, weights
  tasks/taskNNN/        # description.md, context.md, task.yaml
  goldens/taskNNN/      # reference checklist (not ground truth)
  fixtures/             # Manifests; OSS bases vendored under evals/fixtures/_base/
  judges/               # Rubric, golden-coverage, promptfoo config
  scripts/              # Runner, compiler, analysis, human import
  results/              # Raw runs, scores, statistics (gitignored)
  releases/             # Committed snapshots only when claim-ready
```

## Corpus (v2.0)

25 tasks across 5 categories (5 each):

1. Greenfield product design
2. OSS feature design (Commerce, Plane, Outline — **full vendored codebases**)
3. OSS behavior audit (same fixture bases; audit tasks use `*-audit-ready` manifests)
4. Workflow and edge-case design
5. Resilience and degraded states

3 runs per arm × 25 tasks = **150 workflow runs** (150 control invocations + 375 treatment = **525 agent calls**). Human blind eval on a 10-task stratified subset.

## Scoring

| Layer | Weight | Method |
|-------|--------|--------|
| Golden coverage | 40% | Phrase match in **implementation source** vs reference checklist (invariants/scenarios/entities/trade-offs 2×). **Sections not scored** (format-neutral). |
| LLM judge | 40% | 2-model promptfoo rubric on bundled source when API keys set; otherwise arm-neutral heuristic (disclosed, not claim-ready alone) |
| Human eval | 20% | Blind raters review implementations on 10-task subset via Google Form or CSV import |

`analyze.py` computes a **composite** on a 1–5 scale from available layers (renormalizes if human subset is absent). Reports mark `claim_ready: false` when any run is mock, judge is heuristic-only, or human scores are synthetic.

Goldens are a **reference checklist**, not ground truth — any clear wording of the concept counts.

### What this does *not* measure

- Runtime correctness (tests passing, production deployment)
- Live browser/persona-walk verification (see optional secondary metric)
- Model independence (default pin: `claude-code` + Sonnet 4; multi-agent pilots via `--agent`)
- WCAG certification
- Lamina workflow compliance (`evals/`)

## Secondary metric (optional depth)

Primary scoring is **implementation source** (control: post-implement; treatment: post-fix). Optional follow-on for runtime or live verification:

```bash
node benchmarks/scripts/secondary-verify-metric.mjs --help
```

Use for persona-walk findings, test-suite pass rates, or invariant probes — document separately from the primary A/B.

## Reproducing a release

1. Set API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
2. Install reference agent: `claude` CLI (see `release.yaml`)
3. `npm run bench:all` (live — never `--mock`)
4. Run blind human review ([Google Form setup](human/google-form/SETUP.md)); `npm run bench:import-google-form -- --csv responses.csv`
5. Re-run `npm run bench:analyze`
6. Copy `results/report.md` + `results/statistics/stats.json` to `releases/v2.0.0/` only if `claim_ready: true`

**v1.1.0 mock results are retired** — do not use for external claims.

## Claim wording (use only after claim_ready)

> On a public 25-task product-behavior implementation benchmark using **ecological adoption methodology (Design A)**, the same coding agent with Lamina produced higher-quality **implemented product behavior** than Plan-mode planning + implement — the without-Lamina baseline documented in our product demo. Treatment includes Lamina’s verify/fix loop by design (5 phases); control stops after implement (2 phases). Measured by reference-checklist coverage in source, multi-judge rubric scores on code, and blind human evaluation on a 10-task subset. Methodology: `benchmarks/METHODOLOGY.md`. Results pinned to `release.yaml`.

Until live results exist, prefer:

> LaminaBench v2.0 defines a public ecological adoption A/B: Lamina full loop vs Plan + implement, scoring implemented product source. Methodology documented in `benchmarks/METHODOLOGY.md`. Live results not yet published.

## Fixture honesty

| Fixture | Realism |
|---------|---------|
| `commerce-*` | Full vendored Vercel Commerce source tree |
| `plane-*` | Full vendored Plane source tree |
| `outline-*` | Full vendored Outline source tree |

Pinned commits in `release.yaml` and per-task `task.yaml`. Refresh via `npm run fixtures:vendor`.
