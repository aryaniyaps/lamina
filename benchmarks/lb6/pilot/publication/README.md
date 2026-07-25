# LB6 Issue #18 — RewardKit results & reproduction

**Development-only pilot.** This package documents one measured Harbor campaign for [GitHub issue #18](https://github.com/aryaniyaps/lamina/issues/18): stock Harbor + RewardKit LLM-as-judge, full staged Lamina skills, step artifacts.

| Flag | Value |
|---|---|
| `development_only` | `true` |
| `confirmatory` | `false` |
| `marketing_claim_eligible` | `false` |
| Measurement | `rewardkit_llm_judge_v3` |

This is **not** claim-ready LaminaBench-6 confirmatory evidence.

## Claim package (source of truth)

| File | Role |
|---|---|
| [`local-v3-issue18-rewardkit.md`](./local-v3-issue18-rewardkit.md) | Human-readable matrix |
| [`local-v3-issue18-rewardkit.json`](./local-v3-issue18-rewardkit.json) | Machine-readable cells + validity |
| [`local-v3-issue18-rewardkit.campaign.json`](./local-v3-issue18-rewardkit.campaign.json) | Campaign window marker |

**Ignore for this claim:** `local-v3-results.*`, `local-v3-llm-judge-*`, older `manual-publish-plan*.json`, and `publication-result*.json`. Those are earlier / alternate claim surfaces.

## Published matrix (this campaign)

Generated `2026-07-24T14:48:31.283Z` · **12/12** measurement-valid cells · **59** skills staged.

| Task | direct | plan | lamina |
|---|---:|---:|---:|
| `dev-loan-library` | 0.6214 | 0.7233 | **0.7743** |
| `dev-review-room` | 0.5437 | 0.5146 | **0.699** |
| `dev-simple-list` | 0.5898 | 0.6141 | **0.6942** |
| `dev-toggle-preference` | 0.5000 | 0.5413 | **0.6165** |

Means (this seed): lamina **0.696** · plan **0.598** · direct **0.564**.

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

## Fair reading of the claim

**Reasonable to say**

- Under this development pilot harness (RewardKit product judge, ABI-on-implement lamina path, n=1), lamina scored above plan and direct on all four tasks in this campaign.

**Not reasonable to say**

- Confirmatory LaminaBench-6 proof.
- That `.lamina` process quality was graded.
- That `/lamina-verify` ran.
- That +15 percentage points vs both baselines holds on every task / every seed (it does not in this single seed; see matrix).

## Limitations

- Single seed per cell (high variance for coding + LLM judge).
- Child actual model unverified (`child_actual_model_unverified: true`).
- Process-blind product judge by design.
- No lamina-verify step.
- Host-sealed semantic verifier / harbor-fork disabled for Issue #18.
- Absolute machine paths may appear in some support reports (`../reports/skill-rerun-v3.json`); they are local run diagnostics, not the claim surface.

## Related paths

| Path | Role |
|---|---|
| [`../README.md`](../README.md) | Pilot overview |
| [`../lib/rewardkit/`](../lib/rewardkit/) | Judge templates |
| [`../lib/constants.mjs`](../lib/constants.mjs) | Pins + step budgets |
| [`../scripts/run-three-arm.mjs`](../scripts/run-three-arm.mjs) | Matrix runner |
| [`../scripts/collect-local-v3-issue18-run.mjs`](../scripts/collect-local-v3-issue18-run.mjs) | Collect script |
| [`../harbor/tasks-v3/`](../harbor/tasks-v3/) | Generated Harbor tasks |
