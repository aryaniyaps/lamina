# Reproduce: Lamina Product Coding Pilot (3-arm)

This document is the **operator checklist** for reproducing the development-only **Lamina Product Coding Pilot** (direct / plan / lamina). Anyone with Harbor, Docker, and API keys should be able to rebuild tasks, run the same three arms, collect results, and recompute the median claim.

> Current safety boundary: the live Harbor steps in this historical checklist
> are blocked. Docker-daemon descendants are outside the crash-safe client
> scope, so `run-three-arm.mjs` refuses direct and wrapped launches. Do not
> bypass that guard. You can still recompute and inspect the committed three
> seed packages; new live collection requires daemon-side ownership support.

*(Operator note: LB6 / GitHub issue #18 / Harbor RewardKit.)*

**Claim surface:** per-cell **median of 3 seeds** → [`local-v3-issue18-rewardkit-median.md`](./local-v3-issue18-rewardkit-median.md)

**Scope:** `development_only: true` · `confirmatory: false` · not marketing-claim-eligible.

**Harbor Hub (public):**

| Share | URL / id |
|---|---|
| Dataset (benchmark) | https://hub.harborframework.com/datasets/shiv-eshwar/lb6-dev-pilot-issue18-rewardkit |
| Dataset id | `shiv-eshwar/lb6-dev-pilot-issue18-rewardkit@latest` |
| Result jobs (36) | [`harbor-job-urls.tsv`](./harbor-job-urls.tsv) |
| Publish status | [`harbor-publish-status.md`](./harbor-publish-status.md) |

---

## Run from Harbor Hub (quick start)

Use this when you want to **pull the published dataset** and run with stock Harbor (same agent/model pins as the pilot). For the full local 3-seed collect/median protocol, see [Full reproduce — one seed](#full-reproduce--one-seed) below.

```bash
# Prerequisites: harbor 0.18.x, Docker, and env:
#   CURSOR_API_KEY=...
#   OPENAI_API_KEY=...
#   REWARDKIT_JUDGE=openai/gpt-5.5
#   LITELLM_DROP_PARAMS=1

harbor run \
  -d shiv-eshwar/lb6-dev-pilot-issue18-rewardkit@latest \
  -a cursor-cli \
  -m cursor/composer-2.5 \
  --env-file .env \
  -n 1
```

Pinned publish tag (same content as `latest` at publish time):

```bash
harbor run \
  -d shiv-eshwar/lb6-dev-pilot-issue18-rewardkit@issue18-rewardkit-median-n3 \
  -a cursor-cli \
  -m cursor/composer-2.5 \
  --env-file .env \
  -n 1
```

Notes:

- Dataset = **12 tasks** (4 × direct/plan/lamina). A full matrix still means one run per task arm.
- Published **jobs** are the evidence for the median claim; Hub dataset runs are for re-execution, not a substitute for the frozen seed packages in [`seeds/`](./seeds/).
- Bit-for-bit parity with the published median (skill staging, campaign marker, archive/median scripts) uses the local protocol further down.

---

## What you are reproducing

| Item | Value |
|---|---|
| Tasks | `dev-loan-library`, `dev-review-room`, `dev-simple-list`, `dev-toggle-preference` |
| Arms | `direct`, `plan`, `lamina` only (no `checklist`) |
| Cells per seed | 12 (4 × 3) |
| Seeds | 3 independent full matrices → per-cell median |
| Judge | Harbor RewardKit · `openai/gpt-5.5` |
| Judged files | `/app/app.mjs`, `/app/ui.mjs` only |
| Skills (lamina) | all staged `skills/lamina*` (~59) |
| Not run | `/lamina-verify` as a Harbor step |

Frozen behavioral harness (do not “improve” while verifying):

- Lamina step budgets: **240 / 360 / 600 / 300** (`lib/constants.mjs` → `LAMINA_STEPS`)
- ABI + selfcheck injected on **implement + fix** (implement ships judged ABI; no throwaway `app.js`)
- Baselines: `shape_build` 750s → `verify_fix` 750s

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 20 | repo `engines` |
| Docker | Harbor runs agent containers |
| Harbor CLI **0.18.x** | `harbor --version` |
| Repo root `.env` | `CURSOR_API_KEY=...` |
| `benchmarks/.env` or root `.env` | `OPENAI_API_KEY=...`, `REWARDKIT_JUDGE=openai/gpt-5.5`, `LITELLM_DROP_PARAMS=1` |
| Optional Harbor skills | `npx skills add harbor-framework/harbor --skill publish` and `--skill rewardkit` |

Template: [`../../../.env.example`](../../../.env.example).

**Never commit** `.env`, `jobs/`, or raw `pilot/logs/` (gitignored). Seed packages under `publication/seeds/` are the portable public record.

---

## Expected time / cost (ballpark)

| Phase | Wall time (order of magnitude) |
|---|---|
| Build + validate | minutes |
| One seed (12 cells, concurrency 1) | ~1–1.5 hours |
| Three seeds + retries | ~3–5 hours |
| Median recompute | seconds |

API cost depends on Cursor agent + OpenAI judge usage; treat as non-trivial. Prefer concurrency `1` for cleaner logs and fewer Harbor races.

---

## Quick verify (recompute published median only)

No Harbor jobs required — uses committed seed JSONs:

```bash
# from repo root
npm run bench:lb6:v3:median-issue18
```

This regenerates `local-v3-issue18-rewardkit-median.{md,json}` from `seeds/seed-{1,2,3}-issue18-rewardkit.json`. Diff should be empty (or only `generated_at` timestamp).

---

## Full reproduce — one seed

```bash
# from repo root

# 0) Env loaded (CURSOR_API_KEY + OPENAI_API_KEY + REWARDKIT_JUDGE)

# 1) Build tasks-v3 for the four tasks × three arms
npm run bench:lb6:v3:build -- --tasks dev-loan-library,dev-review-room,dev-simple-list,dev-toggle-preference

# 2) Validate RewardKit / pilot contract
npm run bench:lb6:v3:validate

# 3) Open a clean campaign window (ignore older jobs/)
node benchmarks/lb6/pilot/scripts/collect-local-v3-issue18-run.mjs --force-marker

# 4) Historical live matrix entrypoint. This now emits a safety refusal report;
# do not bypass it while Harbor descendants remain externally owned.
npm run bench:lb6:v3:run

# 5) Collect live claim files
npm run bench:lb6:v3:collect-issue18

# 6) Freeze into seeds/ (refuses overwrite unless --force)
node benchmarks/lb6/pilot/scripts/archive-issue18-seed.mjs --seed N
```

Replace `N` with `1`, `2`, or `3`. After three archived seeds:

```bash
npm run bench:lb6:v3:median-issue18
```

### Validity gate

A seed is complete only when collect reports **`12/12` measurement-valid** cells.

If a cell is `measurementValid=false` (timeout, non-zero agent exit, missing reward, etc.):

1. **Do not change the harness.**
2. Re-run **that task × arm only** (same `run-three-arm.mjs` flags).
3. Collect again (pickBest keeps the newest valid job in the campaign window).
4. Record the retry in `publication/seeds/RUN_NOTES.md` (and local `logs/seed-N/NOTES.md` if you keep operator logs).

Published seed packages already include only the **valid** replacement job for any retried cell.

---

## Three-seed protocol (what we published)

| Seed | Package | Notes |
|---|---|---|
| 1 | [`seeds/seed-1-issue18-rewardkit.*`](./seeds/) | Original matrix |
| 2 | [`seeds/seed-2-issue18-rewardkit.*`](./seeds/) | 1 cell retry — see [`seeds/RUN_NOTES.md`](./seeds/RUN_NOTES.md) |
| 3 | [`seeds/seed-3-issue18-rewardkit.*`](./seeds/) | 1 cell retry — see [`seeds/RUN_NOTES.md`](./seeds/RUN_NOTES.md) |

Between seeds: `--force-marker` so collect does not mix jobs across campaigns.

Aggregation: **per-cell median** of the three rewards (not mean of means). Script: `scripts/compute-issue18-median.mjs`.

---

## How to audit a cell (anti-handwave)

1. Open the relevant `seeds/seed-N-issue18-rewardkit.json` → cell `jobName`.
2. If you still have the local job dir, open:
   - lamina: `jobs/<job>/…/steps/fix/verifier/reward.json`
   - direct/plan: `…/steps/verify_fix/verifier/reward.json`
3. Confirm `reward-details.json` → judge files are only `app.mjs` and `ui.mjs`.
4. Confirm judge model is `openai/gpt-5.5`.
5. Confirm reward matches the seed JSON / median table.

If markdown and job verifier disagree, **trust the job verifier** and re-run collect.

Job directories are large and gitignored. Portable evidence in-repo: seed JSON `jobName` + reward + `measurementValid`.

---

## Pins (match these for a fair comparison)

| Pin | Value |
|---|---|
| Harbor | `0.18.0` |
| Agent | `cursor-cli` |
| Model | `cursor/composer-2.5` |
| Agent runtime image | `lb6-pilot-agent-runtime:cursor-20260720` |
| Cursor CLI (in image) | `2026.07.20-8cc9c0b` |
| Benchmark version | `lb6-dev-pilot-v3` |
| Campaign id | `lb6-dev-pilot-skill-rerun-v3` |
| Measurement | `rewardkit_llm_judge_v3` |
| Judge | `REWARDKIT_JUDGE=openai/gpt-5.5` |
| Skill pin | `PINNED_SKILL_COMMIT` in `lib/constants.mjs` |
| Attempts per cell | 1 (retries only for invalid measurement, not for low score) |

Source of pin constants: [`../lib/constants.mjs`](../lib/constants.mjs).  
Judge templates: [`../lib/rewardkit/`](../lib/rewardkit/).

Seed JSON fields `harness_commit` are **collect-time HEAD** snapshots. Seed 1 may show an older SHA if history was rewritten after that collect; behavioral harness for all three published seeds is the ABI-on-implement path above. Prefer matching `constants.mjs` + regenerated `tasks-v3` over chasing a single git SHA.

---

## What not to change while “verifying”

Changing any of these makes the run a **new experiment**, not a reproduction:

- Step budgets / step graph
- Judge model or judge prompt
- Skill set / skill pin
- ABI injection timing (implement vs fix-only)
- Adding `/lamina-verify` or host-sealed graders
- Scoring `.lamina/` process artifacts

If you intentionally change the harness, start a new campaign id and do not overwrite `seeds/seed-{1,2,3}-*`.

---

## Fair reading

**OK to say:** under this development pilot (RewardKit product judge, ABI-on-implement lamina path, n=3 median), lamina’s median score is above plan and direct on all four tasks.

**Not OK to say:** confirmatory LaminaBench-6 proof; that process artifacts were graded; that every seed had the same deltas; that +15pp vs both baselines holds on every task.

---

## Related

| Path | Role |
|---|---|
| [`README.md`](./README.md) | Claim package index |
| [`harbor-publish-status.md`](./harbor-publish-status.md) | Hub dataset + job publish record |
| [`harbor-job-urls.tsv`](./harbor-job-urls.tsv) | 36 public job URLs |
| [`../harbor/dataset-issue18-rewardkit/`](../harbor/dataset-issue18-rewardkit/) | Local dataset package (Hub source) |
| [`seeds/README.md`](./seeds/README.md) | Seed file map |
| [`seeds/RUN_NOTES.md`](./seeds/RUN_NOTES.md) | Retries / exceptions (committed) |
| [`../README.md`](../README.md) | Pilot overview |
| [`../scripts/run-three-arm.mjs`](../scripts/run-three-arm.mjs) | Matrix runner |
| [`../scripts/collect-local-v3-issue18-run.mjs`](../scripts/collect-local-v3-issue18-run.mjs) | Collect |
| [`../scripts/archive-issue18-seed.mjs`](../scripts/archive-issue18-seed.mjs) | Freeze live → seed-N |
| [`../scripts/compute-issue18-median.mjs`](../scripts/compute-issue18-median.mjs) | Median claim |
