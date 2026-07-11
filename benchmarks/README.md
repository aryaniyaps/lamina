# LaminaBench v1

**Public product-behavior implementation benchmark** comparing the same coding agent with and without Lamina, run via [Harbor](https://www.harborframework.com/) in a **SkillsBench-style paired** design.

This directory is **not** [`evals/`](../evals/). Those are internal skill-compliance regression tests. LaminaBench measures whether Lamina (skills + workflow conventions) improves **implemented product behavior** in code on realistic tasks.

> **Status (v1):** Claim surface is **checklist coverage + LLM rubric on implemented source** under Design B (`design_b_skillsbench_paired`). Scoring runs in-container via Harbor Rewardkit. **No live results are published yet.**

**Methodology:** [Design B — SkillsBench-style paired comparison](METHODOLOGY.md). Same `instruction.md` for both arms; one continuous Harbor agent rollout each. Control = no skills, no AGENTS.md. Treatment = Lamina skills + AGENTS.md/CLAUDE.md workflow hint.

## What is compared

| Arm | Harbor task | Environment |
|-----|-------------|-------------|
| **Control** | `taskNNN-control` | Fixture + `instruction.md` only |
| **Treatment** | `taskNNN-treatment` | Same brief + Lamina skills + `AGENTS.md`/`CLAUDE.md` |

`instruction.md` never names Lamina skills (SkillsBench rule). Workflow guidance lives only in treatment project conventions.

## Workflow (Harbor + Rewardkit)

1. `npm run bench:harbor:sync` — refresh Harbor workspaces, [Rewardkit](https://www.harborframework.com/docs/rewardkit) verifier bundles, and `task.toml`
2. `harbor run -a claude-code` with `prompt_template.j2` (unattended contract)
3. Agent completes product work in one continuous rollout
4. Verifier (`rewardkit /tests`) scores golden coverage + 10-criterion LLM judge → `reward.json` + `reward-details.json`
5. Inspect results via `harbor view` or job directories under `results/harbor/jobs/`

**Unattended policy:** No mid-run user. No harness auto-reply on clarify. Stalls → reward 0 + `clarify_stall` flag in verifier output.

Use `harbor view` → Verifier Logs → Rewards to inspect per-criterion judge reasoning.

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
| `npm run bench:harbor:sync` | Sync Harbor task workspaces + Rewardkit verifier bundles |
| `npm run bench:harbor:publish` | Publish dataset + tasks to Harbor registry (no results needed) |
| `npm run bench:validate` | Validate registry + Harbor tasks + goldens |
| `npm run bench:run` | Harbor sync + run (`--pilot`, `--tasks`, `--runs`, `--fresh`) |
| `npm run bench:pilot` | Sync task001 and validate structure |
| `npm run bench:all` | validate → run |

## Layout

```
benchmarks/
  METHODOLOGY.md
  methodology.json
  release.yaml
  goldens/              # golden.yaml per task (synced into task tests/)
  fixtures/             # OSS/greenfield workspace manifests
  schemas/              # golden + task JSON schemas
  harbor/
    registry.yaml       # task metadata (category, fixture, prompt)
    prompt_template.j2
    verifier/           # canonical Rewardkit verifier (synced into each task tests/)
    overlays/treatment/ AGENTS.md, CLAUDE.md
    tasks/              # canonical Harbor tasks (instruction.md committed; workspace gitignored)
      taskNNN-control/
      taskNNN-treatment/
  scripts/
    harbor-sync.mjs
    harbor-tasks.mjs
    run-harbor-bench.mjs
  harbor/dataset/       # dataset.toml for Harbor registry (aryaniyaps/lamina-bench)
  results/harbor/jobs/  # Harbor job output (gitignored)
```

## Corpus (v1)

25 tasks × 2 arms × 3 runs = **150 Harbor trials**. See [METHODOLOGY.md](METHODOLOGY.md) for Design B rationale.

## Harbor runner flags

| Flag | Purpose |
|------|---------|
| `--pilot` | First 3 tasks only |
| `--tasks task001` | Filter task ids |
| `--runs N` | Attempts per arm (default from `release.yaml`) |
| `--fresh` | Wipe `results/harbor/jobs/` before run |
| `--sync-only` | Refresh Harbor workspaces without running |

**LLM judge:** Requires `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in `benchmarks/.env` (passed via `[verifier.env]` in `task.toml`). Override model with `REWARDKIT_JUDGE` if needed.
