# LaminaBench v1

**Public product-behavior implementation benchmark** comparing the same coding agent with and without Lamina, run via [Harbor](https://www.harborframework.com/) in a **SkillsBench-style paired** design.

This directory is **not** [`evals/`](../evals/). Those are internal skill-compliance regression tests. LaminaBench measures whether Lamina (skills + workflow conventions) improves **implemented product behavior** in code on realistic tasks.

> **Status (v1):** Claim surface is **checklist coverage + LLM rubric on implemented source** under Design B (`design_b_skillsbench_paired`). Behavior probes, clarify stall rate, cost/time, and optional human review are reported separately. **No live results are published yet.**

**Methodology:** [Design B — SkillsBench-style paired comparison](METHODOLOGY.md). Same `instruction.md` for both arms; one continuous Harbor agent rollout each. Control = no skills, no AGENTS.md. Treatment = Lamina skills + AGENTS.md/CLAUDE.md workflow hint.

## What is compared

| Arm | Harbor task | Environment |
|-----|-------------|-------------|
| **Control** | `taskNNN-control` | Fixture + `instruction.md` only |
| **Treatment** | `taskNNN-treatment` | Same brief + Lamina skills + `AGENTS.md`/`CLAUDE.md` |

`instruction.md` never names Lamina skills (SkillsBench rule). Workflow guidance lives only in treatment project conventions.

## Workflow (Harbor)

1. `npm run bench:harbor:sync` — refresh Harbor workspaces, verifier bundles, and `task.toml`
2. `harbor run -a claude-code` with `prompt_template.j2` (unattended contract)
3. Agent completes product work in one continuous rollout
4. Verifier scores golden coverage + LLM judge → `reward.json`
5. `ingest-harbor-results` → `results/raw/index.jsonl` for `bench:score` / `bench:analyze`

**Unattended policy:** No mid-run user. No harness auto-reply on clarify. Stalls → reward 0 + `clarify_stall` secondary metric.

## Quick start

```bash
npm install
uv tool install harbor   # Harbor CLI
npm run bench:env-check  # Anthropic + Docker + Harbor
npm run bench:validate
npm run bench:harbor:sync -- --tasks task001
npm run bench:all
```

## Commands

| Script | Purpose |
|--------|---------|
| `npm run bench:env-check` | Verify Anthropic credentials, Docker, Harbor CLI |
| `npm run bench:harbor:sync` | Sync Harbor task workspaces + verifier bundles |
| `npm run bench:harbor:publish` | Publish dataset to Harbor registry (after `harbor auth login`) |
| `npm run bench:harbor:ingest` | Ingest Harbor job outputs into `results/raw/` |
| `npm run bench:validate` | Validate registry + Harbor tasks + goldens + probes |
| `npm run bench:run` | Harbor sync + run + ingest (`--pilot`, `--tasks`, `--runs`, `--fresh`) |
| `npm run bench:score` | Golden coverage + LLM judge + behavior probes |
| `npm run bench:analyze` | Stats/composite/cost/clarify stalls → `results/report.md` |
| `npm run bench:all` | validate → run → score → analyze |

## Layout

```
benchmarks/
  METHODOLOGY.md
  methodology.json
  release.yaml
  harbor/
    registry.yaml       # task metadata (category, fixture, prompt)
    prompt_template.j2
    overlays/treatment/AGENTS.md, CLAUDE.md
    tasks/              # canonical Harbor tasks (instruction.md committed; workspace gitignored)
      taskNNN-control/
      taskNNN-treatment/
  scripts/
    harbor-sync.mjs
    harbor-tasks.mjs
    run-harbor-bench.mjs
    ingest-harbor-results.mjs
    harbor-score.mjs
  harbor/dataset/       # dataset.toml for Harbor registry (aryaniyaps/lamina-bench)
  results/harbor/jobs/  # Harbor job output (gitignored)
  releases/             # Committed snapshots only when claim-ready
```

## Corpus (v1)

25 tasks × 2 arms × 3 runs = **150 Harbor trials**. See [METHODOLOGY.md](METHODOLOGY.md) for Design B rationale.

## Harbor runner flags

| Flag | Purpose |
|------|---------|
| `--pilot` | First 3 tasks only |
| `--tasks task001` | Filter task ids |
| `--runs N` | Attempts per arm (default from `release.yaml`) |
| `--fresh` | Wipe `index.jsonl` before run |
| `--sync-only` | Refresh Harbor workspaces without running |
| `--ingest-only` | Re-ingest existing Harbor jobs |

**Resume / cost:** Jobs with matching `job_fingerprint` under `results_contract_version: 1.0.0` are skipped. Use `--fresh` to wipe the index.

**Unattended / clarify:** No harness auto-reply. Clarify stalls → verifier reward 0; reported as `clarify_stall` secondary metric.
