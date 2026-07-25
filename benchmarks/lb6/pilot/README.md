# Lamina Product Coding Pilot (v3)

Matched three-arm Harbor pilot: **direct** vs **plan** vs **lamina** on small product apps.

## Quick links

| Doc | Purpose |
|---|---|
| [`publication/REPRODUCE.md`](./publication/REPRODUCE.md) | **Reproduce** — Hub run + local 3-seed protocol |
| [`publication/README.md`](./publication/README.md) | Claim scope + median matrix |
| [`publication/local-v3-issue18-rewardkit-median.md`](./publication/local-v3-issue18-rewardkit-median.md) | **Publish table** (median of 3 seeds) |
| [`publication/harbor-publish-status.md`](./publication/harbor-publish-status.md) | Hub dataset + public jobs |
| [Harbor dataset](https://hub.harborframework.com/datasets/lamina/product-bench) | Public benchmark package (`lamina/product-bench`) |
| [`publication/seeds/`](./publication/seeds/) | Frozen seed-1 / seed-2 / seed-3 packages |
| [`lib/rewardkit/`](./lib/rewardkit/) | Judge templates |
| [`lib/constants.mjs`](./lib/constants.mjs) | Harbor / budget / measurement pins |

## Arms

- `direct` — coding agent, no Lamina skills
- `plan` — plan-first coding agent, no Lamina skills
- `lamina` — `/lamina-init` + `/lamina-design`, then implement/fix coding with staged skills

Forbidden for this pilot: `checklist`.

## Common commands

```bash
# from repo root
npm run bench:lb6:v3:build -- --tasks dev-loan-library,dev-review-room,dev-simple-list,dev-toggle-preference
npm run bench:lb6:v3:validate
node benchmarks/lb6/pilot/scripts/run-three-arm.mjs --allow-dirty-harness --concurrency 1 --tasks dev-loan-library
npm run bench:lb6:v3:collect-issue18
node benchmarks/lb6/pilot/scripts/archive-issue18-seed.mjs --seed 1
npm run bench:lb6:v3:median-issue18
```

Full multi-seed checklist: [`publication/REPRODUCE.md`](./publication/REPRODUCE.md).

Env: see [`../.env.example`](../.env.example) (`CURSOR_API_KEY`, `OPENAI_API_KEY`, `REWARDKIT_JUDGE`).

## Layout

| Path | Role |
|---|---|
| `harbor/tasks-v3/` | Generated Harbor task dirs |
| `harbor/dataset-issue18-rewardkit/` | Public Hub dataset package |
| `scripts/` | build / validate / run / collect / archive / median |
| `lib/` | constants, RewardKit, shared helpers |
| `skill-bundle/` | staged skill pin + manifest |
| `publication/` | claim artifacts + reproduce docs |
| `publication/seeds/` | frozen per-seed matrices (portable) |
| `reports/` | operator aggregate reports (support) |
| `logs/` | local tee logs (gitignored) |

## Status flags

All pilot outputs are **`development_only`** and **`confirmatory: false`**. Do not treat them as LaminaBench-6 confirmatory publication without a separate confirmatory campaign.
