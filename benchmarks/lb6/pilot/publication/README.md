# LB6 Issue #18 — RewardKit results & reproduction

**Development-only pilot.** Stock Harbor + RewardKit LLM-as-judge, full staged Lamina skills, step artifacts. Claim table is the **median of three independent full-matrix seeds**.

| Flag | Value |
|---|---|
| `development_only` | `true` |
| `confirmatory` | `false` |
| `marketing_claim_eligible` | `false` |
| Measurement | `rewardkit_llm_judge_v3` |
| Aggregation | per-cell **median** of n=3 seeds |

This is **not** claim-ready LaminaBench-6 confirmatory evidence.

## Claim package (source of truth)

| File | Role |
|---|---|
| [`local-v3-issue18-rewardkit-median.md`](./local-v3-issue18-rewardkit-median.md) | **Publish table** (median of 3 seeds) |
| [`local-v3-issue18-rewardkit-median.json`](./local-v3-issue18-rewardkit-median.json) | Per-cell seed values + median/min/max + job refs |
| [`seeds/`](./seeds/) | Frozen seed-1 / seed-2 / seed-3 packages |
| `../logs/seed-{1,2,3}/` | Named run logs + job inventories |

Live collect output (`local-v3-issue18-rewardkit.{md,json,campaign.json}`) mirrors the **latest** campaign window only — do not treat it as the multi-seed claim; use the median + `seeds/` packages.

**Ignore for this claim:** `local-v3-results.*`, `local-v3-llm-judge-*`, older `manual-publish-plan*.json`, and `publication-result*.json`.

## Published matrix (median of 3 seeds)

Each seed **12/12** valid · **59** skills staged · judge `openai/gpt-5.5`.

| Task | direct | plan | lamina |
|---|---:|---:|---:|
| `dev-loan-library` | 0.6214 | 0.5655 | **0.75** |
| `dev-review-room` | 0.5655 | 0.5146 | **0.6699** |
| `dev-simple-list` | 0.6141 | 0.6141 | **0.7209** |
| `dev-toggle-preference` | 0.5413 | 0.5413 | **0.6165** |

**Means (median matrix):** lamina **0.6893** · plan **0.5589** · direct **0.5856**.

Per-seed tables and cell-level spread: [`local-v3-issue18-rewardkit-median.md`](./local-v3-issue18-rewardkit-median.md).

## What is being measured

- **Judge:** Harbor RewardKit (`openai/gpt-5.5` in this run).
- **Scored files only:** `/app/app.mjs`, `/app/ui.mjs`.
- **Not scored:** `.lamina/` process artifacts, planning markdown, or arm process differences.
- **Harbor still collects** `/app/.lamina` as step artifacts for inspection — collection is not scoring.

Judge templates live in `../lib/rewardkit/` (`judge.toml`, `prompt.md`).

## Arms

| Arm | Harbor steps (agent budget 1500s total) | Skills |
|---|---|---|
| `direct` | `shape_build` 750s → `verify_fix` 750s | none |
| `plan` | same as direct | none |
| `lamina` | `lamina_init` 240 → `lamina_design` 360 → `implement` 600 → `fix` 300 | all staged `skills/lamina*` (~59) |

### Lamina process scope (important)

Invoked as first-class steps:

1. `/lamina-init`
2. `/lamina-design`

Then normal coding on `implement` / `fix` (**no** `/lamina-*` slash commands).

**Not run as a Harbor step:** `/lamina-verify`. The `lamina-verify` skill may be staged, but this campaign does not execute a verify loop step.

### Harness detail that matters for reproduction

On the lamina arm, the **published ABI + selfcheck** are injected starting at **`implement`** (not only on `fix`). Implement must ship `app.mjs` / `ui.mjs`; a throwaway non-ABI `app.js` prototype is explicitly forbidden. Baselines still shape without ABI, then receive ABI on `verify_fix`.

## Pins (reproduce these)

| Pin | Value |
|---|---|
| Harbor | `0.18.0` |
| Agent | `cursor-cli` |
| Model | `cursor/composer-2.5` |
| Agent runtime image | `lb6-pilot-agent-runtime:cursor-20260720` |
| Cursor CLI (in image) | `2026.07.20-8cc9c0b` |
| Benchmark version | `lb6-dev-pilot-v3` |
| Campaign id | `lb6-dev-pilot-skill-rerun-v3` |
| Measurement contract | `rewardkit_llm_judge_v3` |
| Judge model | `openai/gpt-5.5` (`REWARDKIT_JUDGE=openai/gpt-5.5`) |
| Tasks | `dev-loan-library`, `dev-review-room`, `dev-simple-list`, `dev-toggle-preference` |
| Attempts | 1 per cell (n=1) |
| Harness commit recorded in results JSON | `81bb880b7c57f7cf5a9698deb2cd7869d6735296` |

## Prerequisites

1. Docker + `harbor` CLI (`0.18.x`).
2. Repo root `.env` with `CURSOR_API_KEY=...`.
3. `benchmarks/.env` (or root `.env`) with:
   ```bash
   OPENAI_API_KEY=...
   REWARDKIT_JUDGE=openai/gpt-5.5
   LITELLM_DROP_PARAMS=1
   ```
   See [`../../../.env.example`](../../../.env.example).
4. Optional Harbor skills (operator machine):
   ```bash
   npx skills add harbor-framework/harbor --skill publish
   npx skills add harbor-framework/harbor --skill rewardkit
   ```

## Reproduce locally

From the repo root:

```bash
# 1) Build the four tasks × three arms (tasks-v3)
npm run bench:lb6:v3:build -- --tasks dev-loan-library,dev-review-room,dev-simple-list,dev-toggle-preference

# 2) Validate RewardKit / pilot contract
npm run bench:lb6:v3:validate

# 3) Run one task at a time (recommended; full matrix ~1 hour)
node benchmarks/lb6/pilot/scripts/run-three-arm.mjs \
  --allow-dirty-harness \
  --concurrency 1 \
  --tasks dev-loan-library

# repeat for: dev-review-room, dev-simple-list, dev-toggle-preference

# 4) Collect Issue #18 claim artifacts
npm run bench:lb6:v3:collect-issue18
```

Start a new campaign window (ignore older jobs):

```bash
node benchmarks/lb6/pilot/scripts/collect-local-v3-issue18-run.mjs --force-marker
# then re-run arms and collect again
```

Jobs land under repo-root `jobs/` (gitignored). Publication files update under this directory.

## How to audit a cell (anti-handwave)

1. Open `local-v3-issue18-rewardkit.json` → find the cell’s `jobPath` / `jobName`.
2. Confirm final reward:
   - lamina: `jobs/<job>/…/steps/fix/verifier/reward.json`
   - direct/plan: `…/steps/verify_fix/verifier/reward.json`
3. Confirm judged files in `reward-details.json` → `reward.judge.files` is only `app.mjs` and `ui.mjs`.
4. Confirm judge model is `openai/gpt-5.5`.

If those disagree with the markdown table, trust the job verifier files and re-run collect.

## Multi-seed protocol

1. Archive current collect output as `seeds/seed-N-issue18-rewardkit.*` (do not overwrite prior seeds).
2. `collect-local-v3-issue18-run.mjs --force-marker` to open a new campaign window.
3. Run the same four tasks × three arms (`run-three-arm.mjs --concurrency 1`), tee logs to `../logs/seed-N/seed-N-<task>.log`.
4. Collect; if a cell is `measurementValid=false`, **re-run that arm only** (same harness) until valid; note in `../logs/seed-N/NOTES.md`.
5. After seeds 1–3 exist, recompute [`local-v3-issue18-rewardkit-median.*`](./local-v3-issue18-rewardkit-median.md).

## Fair reading of the claim

**Reasonable to say**

- Under this development pilot harness (RewardKit product judge, ABI-on-implement lamina path, **n=3 median**), lamina’s median score is above plan and direct on all four tasks.

**Not reasonable to say**

- Confirmatory LaminaBench-6 proof.
- That `.lamina` process quality was graded.
- That `/lamina-verify` ran.
- That every seed showed the same deltas (see per-seed tables / ranges in the median doc).

## Limitations

- n=3 seeds reduces (does not eliminate) coding + LLM-judge variance.
- Child actual model unverified (`child_actual_model_unverified: true`).
- Process-blind product judge by design.
- No lamina-verify step.
- Host-sealed semantic verifier / harbor-fork disabled for Issue #18.
- Occasional single-cell retries were required for agent exit/timeout flakiness (documented in seed `NOTES.md`); harness was not changed.

## Related paths

| Path | Role |
|---|---|
| [`../README.md`](../README.md) | Pilot overview |
| [`../lib/rewardkit/`](../lib/rewardkit/) | Judge templates |
| [`../lib/constants.mjs`](../lib/constants.mjs) | Pins + step budgets |
| [`../scripts/run-three-arm.mjs`](../scripts/run-three-arm.mjs) | Matrix runner |
| [`../scripts/collect-local-v3-issue18-run.mjs`](../scripts/collect-local-v3-issue18-run.mjs) | Collect script |
| [`../harbor/tasks-v3/`](../harbor/tasks-v3/) | Generated Harbor tasks |
