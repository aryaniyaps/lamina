# LaminaBench v1

**Public product-behavior implementation benchmark** comparing the real Lamina workflow against a matched generic loop, using Harbor task format and Rewardkit scoring.

This directory is **not** [`evals/`](../evals/). Those are internal skill-compliance regression tests. LaminaBench measures whether the **Lamina design→verify loop** improves **implemented product behavior** vs an equally scaffolded plan→review loop.

> **Status (v1):** Claim surface is **checklist coverage + LLM rubric on implemented source** under Design C (`design_c_ecological_matched_phases`). Scoring runs in-container via Harbor Rewardkit. **No live results are published yet.**

**Methodology:** [Design C — ecological matched phases](METHODOLOGY.md). Same `instruction.md` for both arms; **five matched phases** each with equal turn budgets. Control = generic plan→review loop. Treatment = Lamina init→design→verify loop.

**Why Design C?** We considered asymmetric phased treatment, SkillsBench single-session skills-on/off, and `/lamina`-prefix comparisons — all rejected or demoted to ablations. See [Design evolution](METHODOLOGY.md#design-evolution--what-we-considered-and-why-we-landed-here) for the full rationale.

## What is compared

| Arm | Harbor task | Five-phase workflow |
|-----|-------------|---------------------|
| **Control** | `taskNNN-control` | plan → build order → implement → review → fix |
| **Treatment** | `taskNNN-treatment` | `/lamina-init` → `/lamina-design` → implement → `/lamina-verify` → fix |

`instruction.md` never names Lamina skills. Planning artifacts (`bench-*.md`, `.lamina/`) are excluded from scoring.

## Workflow

1. `npm run bench:harbor:sync` — refresh Harbor workspaces, Rewardkit verifier bundles, and `task.toml`
2. `npm run bench:run` — matched phased agent for **both** arms (`matched-phased-agent.sh`)
3. Verifier (`rewardkit` + `finalize_reward.py`) → `reward.json`
4. `npm run bench:ingest` + `bench:aggregate` → paired summary in `results/aggregated/benchmark.json`
5. Inspect per-trial detail under `results/harbor/jobs/`

**Unattended policy:** No mid-run user. No harness auto-reply on clarify. Stalls → reward 0 + `clarify_stall` flag.

## Quick start

```bash
npm install
uv tool install harbor   # optional — for harbor view / publish
npm run bench:env-check  # Anthropic + Docker
npm run bench:validate
npm run bench:harbor:sync -- --tasks task001
npm run bench:all
```

## Commands

| Script | Purpose |
|--------|---------|
| `npm run bench:env-check` | Verify Anthropic credentials, Docker |
| `npm run bench:harbor:sync` | Sync Harbor task workspaces + Rewardkit verifier bundles |
| `npm run bench:harbor:publish` | Publish dataset + tasks to Harbor registry (no results needed) |
| `npm run bench:validate` | Validate registry + Harbor tasks + goldens |
| `npm run bench:run` | Harbor sync + matched phased run (`--pilot`, `--tasks`, `--runs`, `--fresh`) |
| `npm run bench:ingest` | Job dirs → `results/raw/` JSONL |
| `npm run bench:aggregate` | Paired metrics via `metric.py` → `results/aggregated/benchmark.json` |
| `npm run bench:report` | ingest (fresh) + aggregate |
| `npm run bench:pilot` | Sync task001 and validate structure |
| `npm run bench:all` | validate → run |

## Layout

```
benchmarks/
  METHODOLOGY.md
  methodology.json
  release.yaml
  harbor/
    verifier/
      matched-phased-agent.sh   # canonical 5-phase harness (both arms)
    overlays/treatment/         AGENTS.md, CLAUDE.md
    tasks/                      taskNNN-{control,treatment}/
  scripts/
    run-phased.mjs              # matched phased Docker runner
    run-harbor-bench.mjs        # sync + run + ingest
  results/
    raw/
    aggregated/
    harbor/jobs/
```

## Corpus (v1)

**Published (v1 core):** 5 tasks × 2 arms = **10 trials** per run.

**Full corpus:** 10 tasks × 2 arms = 20 trials.

Run core only: `npm run bench:run -- --suite core`

## Runner flags

| Flag | Purpose |
|------|---------|
| `--pilot` | First 3 tasks only |
| `--suite core\|full` | Filter to published core (5) or full corpus (10) |
| `--arm control\|treatment` | Run one arm only |
| `--tasks task001` | Filter task ids |
| `--runs N` | Attempts per arm (default from `release.yaml`) |
| `--fresh` | Wipe `results/harbor/jobs/` before run |
| `--sync-only` | Refresh Harbor workspaces without running |

**LLM judge:** Requires `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in `benchmarks/.env`.
