# LaminaBench v2.1

**Public product-behavior implementation benchmark** comparing the same coding agent with and without Lamina.

This directory is **not** [`evals/`](../evals/). Those are internal skill-compliance regression tests (routing, init gates, guardrails). LaminaBench measures whether Lamina improves **implemented product behavior** — domain rules, workflows, scenarios, and edge handling **in code** — on realistic tasks.

> **Status (v2.1):** Claim surface is **checklist coverage + LLM rubric on implemented source** under Design A. Behavior probes, cost/time, and optional human review are reported separately. **No live results are published yet.**

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
| 2 | Implement **full product scope** from plan | `/lamina-design` or `/lamina-verify` (audit tasks) |
| 3 | — | Implement from contract |
| 4 | — | `/lamina-verify` post-build |
| 5 | — | Fix issues from `fix.md` (falls back to verify report) |

**2 turns (control)** vs **5 turns (treatment)** — [documented methodology](METHODOLOGY.md), not matched compute.

**Scope:** Greenfield, workflow, and resilience tasks ask for a **full product** (all primary workflows + secondary surfaces), not a minimum demo. OSS feature tasks ask for a complete feature that fits the host product. Audit tasks stay focused: find gaps, then implement the highest-priority fixes across the audit scope.

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
# Live release path (requires agent CLI + Anthropic credentials for LLM judge)
npm run bench:env-check
npm run bench:validate
npm run bench:all
```

## Commands

| Script | Purpose |
|--------|---------|
| `npm run bench:env-check` | Verify Anthropic credentials and gateway reachability |
| `npm run bench:validate` | Validate task + golden + probe schemas and fixtures |
| `npm run bench:probes:generate` | Regenerate structural probes from goldens |
| `npm run bench:run` | Live control/treatment runs (requires agent CLI); `--pilot` for 3-task smoke; `--concurrency N` (default 4); `--fresh` to wipe index |
| `npm run bench:score` | Golden coverage + LLM judge + behavior probes |
| `npm run bench:analyst` | Flag non-discriminating golden/probe items |
| `npm run bench:analyze` | Analyst pass + stats/composite/cost → `results/report.md` |
| `npm run bench:human-packet` | Optional qualitative review packet (not in composite) |
| `npm run bench:import-human` | Import rater CSV (appendix only) |
| `npm run bench:all` | **Live** validate → run → score → analyze |

## Layout

```
benchmarks/
  METHODOLOGY.md        # Design A rationale (ecological adoption — required reading)
  methodology.json      # Machine-readable methodology pin for reports
  release.yaml          # Pinned agent, model, run parameters, weights
  tasks/taskNNN/        # description.md, context.md, task.yaml
  goldens/taskNNN/      # reference checklist (not ground truth)
  probes/taskNNN/       # structural behavior probes (SkillsBench-inspired)
  fixtures/             # Manifests; OSS bases vendored under evals/fixtures/_base/
  judges/               # Rubric, golden-coverage, behavior-probes, promptfoo
  scripts/              # Runner, compiler, analysis, analyst pass
  results/              # Raw runs, scores, statistics (gitignored)
  releases/             # Committed snapshots only when claim-ready
```

## Corpus (v2.1)

25 tasks across 5 categories (5 each):

1. Greenfield product design
2. OSS feature design (Commerce, Plane, Outline — **full vendored codebases**)
3. OSS behavior audit (same fixture bases; audit tasks use `*-audit-ready` manifests)
4. Workflow and edge-case design
5. Resilience and degraded states

3 runs per arm × 25 tasks = **150 workflow runs** (150 control invocations + 375 treatment = **525 agent calls**). Default **4 concurrent workflows** (`--concurrency` / `BENCH_CONCURRENCY`).

## Parallel runner

The harness runs **whole workflows** in parallel (never interleaved phases). Each job gets an isolated workspace under `results/raw/workspaces/{task}_{arm}_run{N}`.

| Flag / env | Default | Purpose |
|------------|---------|---------|
| `--concurrency N` | `4` | Max simultaneous workflows |
| `BENCH_CONCURRENCY` | — | Env override for concurrency |
| `--fresh` | off | Delete `index.jsonl` before run (full re-run) |
| *(resume)* | on | Skip jobs already in `index.jsonl` with `artifact_valid: true` |
| `BENCH_PHASE_TIMEOUT_MS` | `1200000` (20 min) | Per-phase agent timeout; kills hung processes |

**Resume:** Partial runs append to `index.jsonl`. Re-run the same command to continue — completed valid jobs are skipped. Use `--fresh` only when you want to discard prior index rows.

**Fixture cache:** Staged OSS trees are cached under `benchmarks/tmp/fixture-cache/`; skills under `benchmarks/tmp/skills-cache/` — copied per workspace, not re-vendored each run.

**Phase gates:** After each phase the harness checks required files on disk (e.g. `bench-plan.md`, `src/`). One automatic retry on failure; invalid runs are indexed with `artifact_valid: false` and excluded from resume skip until fixed.

```bash
# Pilot (3 tasks × 3 runs × 2 arms), 4 workers
npm run bench:run -- --pilot --concurrency 4

# Single-task smoke, 2 overlapping workflows
npm run bench:run -- --tasks task001 --runs 1 --concurrency 2 --fresh

# Full suite (after pilot passes)
npm run bench:run -- --concurrency 4
```


### Claim composite (50/50)

| Layer | Weight | Method |
|-------|--------|--------|
| Golden coverage | 50% | Phrase match in **implementation source** vs reference checklist (invariants/scenarios/entities/trade-offs 2×). **Sections not scored**. |
| LLM judge | 50% | Claude (Anthropic) promptfoo rubric on bundled source; heuristic fallback is disclosed and not claim-ready |

### Reported separately (not in composite)

| Signal | Method |
|--------|--------|
| Behavior probes | Structural `code_guard` / `entity_model` / `scenario_handler` checks on implementation source |
| Cost / time | Wall-clock from `index.jsonl`; tokens when the agent CLI reports usage |
| Human review | Optional qualitative packet — **not** part of the claim composite |
| Analyst pass | Flags golden/probe items that always pass or always fail on both arms |

`claim_ready: true` requires live runs and an Anthropic LLM judge (not heuristic-only).

Goldens are a **reference checklist**, not ground truth — any clear wording of the concept counts. Probes are stricter: they require code-like context (guards, types, handlers).

### What this does *not* measure

- Runtime product correctness unless you add per-task `probes/run.sh` oracles
- Live browser/persona-walk verification (upgrade path for probes)
- Model independence (default pin: `claude-code` + Sonnet 4; multi-agent pilots via `--agent`)
- WCAG certification
- Lamina workflow compliance (`evals/`)

## Behavior probes

```bash
npm run bench:probes:generate   # from goldens
npm run bench:probes            # score after bench:run
```

## Reproducing a release

1. Copy `benchmarks/.env.example` → `benchmarks/.env` and set credentials:
   - `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (Claude Code gateway) **or** `ANTHROPIC_API_KEY` (direct API)
   - `ANTHROPIC_MODEL` — Sonnet pin for agent runs and LLM judge (overrides `release.yaml`)
2. Install reference agent: `claude` CLI (see `release.yaml`)
3. `npm run bench:env-check` — verify credentials and gateway reachability
4. `npm run bench:all` (live)
5. Copy `results/report.md` + `results/statistics/stats.json` to `releases/v2.0.0/` only if `claim_ready: true`

## Claim wording (use only after claim_ready)

> On LaminaBench (Design A — ecological adoption), the same coding agent with Lamina scored higher than Plan mode + implement on **reference-checklist coverage** and **Claude rubric scores of implemented source**. Treatment includes Lamina’s verify/fix loop by design (5 phases); control stops after implement (2 phases). Wall-clock/token cost and structural behavior-probe lift are reported separately. Methodology: `benchmarks/METHODOLOGY.md`. Results pinned to `release.yaml`.

Until live results exist, prefer:

> LaminaBench defines a public ecological adoption A/B: Lamina full loop vs Plan + implement, with a claim surface of checklist + LLM rubric on implemented source. Live results not yet published.

## Fixture honesty

| Fixture | Realism |
|---------|---------|
| `commerce-*` | Full vendored Vercel Commerce source tree |
| `plane-*` | Full vendored Plane source tree |
| `outline-*` | Full vendored Outline source tree |

Pinned commits in `release.yaml` and per-task `task.yaml`. Refresh via `npm run fixtures:vendor`.
