# LB6 development pilot (v3)

Matched three-arm Harbor pilot used for Issue #18 and local RewardKit measurement.

## Quick links

| Doc | Purpose |
|---|---|
| [`publication/README.md`](./publication/README.md) | **Start here** — claim scope, matrix, reproduce steps |
| [`publication/local-v3-issue18-rewardkit.md`](./publication/local-v3-issue18-rewardkit.md) | Latest Issue #18 results table |
| [`lib/rewardkit/`](./lib/rewardkit/) | RewardKit judge templates |
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
```

Env: see [`../.env.example`](../.env.example) (`CURSOR_API_KEY`, `OPENAI_API_KEY`, `REWARDKIT_JUDGE`).

## Layout

| Path | Role |
|---|---|
| `harbor/tasks-v3/` | Generated Harbor task dirs |
| `scripts/` | build / validate / run / collect |
| `lib/` | constants, RewardKit, shared helpers |
| `skill-bundle/` | staged skill pin + manifest |
| `publication/` | claim artifacts + reproduce docs |
| `reports/` | operator aggregate reports (support) |

## Status flags

All Issue #18 pilot outputs are **`development_only`** and **`confirmatory: false`**. Do not treat them as LaminaBench-6 confirmatory publication without a separate confirmatory campaign.
