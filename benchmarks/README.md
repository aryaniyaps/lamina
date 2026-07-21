# LaminaBench Harbor v4

Prove Lamina works: matched arms, behavior-only reward, Lamina treatment gates.

## Prerequisites

1. `harbor` CLI installed
2. `claude` CLI installed
3. `ANTHROPIC_API_KEY` in the **repo root** `.env` file
4. Docker available for Harbor environments

The runner loads root `.env`, runs a Claude auth preflight, and passes `--env-file` pointing at that file so the Harbor agent container inherits `ANTHROPIC_API_KEY`.

## Quick start

```bash
npm run bench:build
npm run bench:validate
npm run bench:run:pilot:lamina
npm run bench:harvest
```

## Pilot matrix

- Tasks: `pilot-care-circle`, `control-simple-list`
- Arms: `direct`, `checklist`, `lamina`
- Attempts: 2 per arm
- Model: Sonnet (`sonnet`)
- Agent budget: **4,200s (70 min) per arm** — baselines split `shape_build`/`verify_fix` 2,100s each; lamina: init 600 / design 1100 / implement 800 / verify 1100 / fix 600

Full publish matrix:

```bash
npm run bench:run:publish:dry   # list 6 cells
npm run bench:run:publish       # build, validate, run all cells, harvest
```

## Pilot smoke diagnosis (2026-07-20)

Job `lamina-v4-pilot-smoke-direct` validated the harness end-to-end:

- Harbor v4 tasks build and register correctly
- Grader runs after agent step (`behavior_pass_rate`, mid/final logging)
- **Limiter (resolved):** set `ANTHROPIC_API_KEY` in the repo root `.env`; runner forwards it with `--env-file`

## Structure

| Path | Role |
|---|---|
| `corpus/manifest.json` | Tasks, goldens, pilot config |
| `corpus/lamina-bench-skills.json` | Loop + risk-capability skill allowlist for lamina arm |
| `lib/behavior-grade.mjs` | Behavior oracle + treatment gates |
| `lib/behavior-selfcheck.mjs` | Structural agent self-check (no golden expects) |
| `scripts/build-harbor-benchmark.mjs` | Generate Harbor tasks (2-step baselines, 5-step lamina) |
| `scripts/run-harbor-arm.mjs` | Run arm with auth preflight |
| `scripts/harvest-lamina-artifacts.mjs` | Copy `.lamina/` from results |
