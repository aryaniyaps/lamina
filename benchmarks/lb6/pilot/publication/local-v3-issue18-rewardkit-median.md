# LB6 Issue #18 RewardKit — median of 3 seeds

**Development-only.** Claim surface = **per-cell median** across three independent full-matrix re-runs (same harness, gpt-5.5 RewardKit).

Per-seed packages: [`seeds/`](./seeds/) · Logs: `../logs/seed-{1,2,3}/` · Reproduce: [README.md](./README.md)

## Verdict

- Status: `ready_for_manual_publish`
- Aggregation: `median` of n=3 seeds
- Each seed: `12/12` measurement-valid
- Measurement: `rewardkit_llm_judge_v3`
- Skills staged: `59`
- Generated: `2026-07-24T19:28:33.530344Z`
- `development_only: true` / `confirmatory: false`

## Median reward matrix (publish table)

| Task | direct | plan | lamina |
|---|---:|---:|---:|
| `dev-loan-library` | 0.6214 | 0.5655 | 0.75 |
| `dev-review-room` | 0.5655 | 0.5146 | 0.6699 |
| `dev-simple-list` | 0.6141 | 0.6141 | 0.7209 |
| `dev-toggle-preference` | 0.5413 | 0.5413 | 0.6165 |

**Means (median matrix):** lamina **0.6893** · plan **0.5589** · direct **0.5856**

## Per-seed matrices

### Seed 1 (`2026-07-24T14:48:31.283Z`)

| Task | direct | plan | lamina |
|---|---:|---:|---:|
| `dev-loan-library` | 0.6214 | 0.7233 | 0.7743 |
| `dev-review-room` | 0.5437 | 0.5146 | 0.699 |
| `dev-simple-list` | 0.5898 | 0.6141 | 0.6942 |
| `dev-toggle-preference` | 0.5 | 0.5413 | 0.6165 |

### Seed 2 (`2026-07-24T18:08:09.055Z`)

| Task | direct | plan | lamina |
|---|---:|---:|---:|
| `dev-loan-library` | 0.5194 | 0.5388 | 0.699 |
| `dev-review-room` | 0.5655 | 0.4976 | 0.6699 |
| `dev-simple-list` | 0.6141 | 0.5898 | 0.7209 |
| `dev-toggle-preference` | 0.5704 | 0.5655 | 0.4199 |

### Seed 3 (`2026-07-24T19:28:15.975Z`)

| Task | direct | plan | lamina |
|---|---:|---:|---:|
| `dev-loan-library` | 0.6942 | 0.5655 | 0.75 |
| `dev-review-room` | 0.5898 | 0.5655 | 0.6408 |
| `dev-simple-list` | 0.6675 | 0.6408 | 0.7791 |
| `dev-toggle-preference` | 0.5413 | 0.5413 | 0.75 |

## Per-cell seed spread (median / min–max)

| Task | Arm | seed1 | seed2 | seed3 | median | min | max | range |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `dev-loan-library` | direct | 0.6214 | 0.5194 | 0.6942 | **0.6214** | 0.5194 | 0.6942 | 0.1748 |
| `dev-loan-library` | plan | 0.7233 | 0.5388 | 0.5655 | **0.5655** | 0.5388 | 0.7233 | 0.1845 |
| `dev-loan-library` | lamina | 0.7743 | 0.699 | 0.75 | **0.75** | 0.699 | 0.7743 | 0.0753 |
| `dev-review-room` | direct | 0.5437 | 0.5655 | 0.5898 | **0.5655** | 0.5437 | 0.5898 | 0.0461 |
| `dev-review-room` | plan | 0.5146 | 0.4976 | 0.5655 | **0.5146** | 0.4976 | 0.5655 | 0.0679 |
| `dev-review-room` | lamina | 0.699 | 0.6699 | 0.6408 | **0.6699** | 0.6408 | 0.699 | 0.0582 |
| `dev-simple-list` | direct | 0.5898 | 0.6141 | 0.6675 | **0.6141** | 0.5898 | 0.6675 | 0.0777 |
| `dev-simple-list` | plan | 0.6141 | 0.5898 | 0.6408 | **0.6141** | 0.5898 | 0.6408 | 0.051 |
| `dev-simple-list` | lamina | 0.6942 | 0.7209 | 0.7791 | **0.7209** | 0.6942 | 0.7791 | 0.0849 |
| `dev-toggle-preference` | direct | 0.5 | 0.5704 | 0.5413 | **0.5413** | 0.5 | 0.5704 | 0.0704 |
| `dev-toggle-preference` | plan | 0.5413 | 0.5655 | 0.5413 | **0.5413** | 0.5413 | 0.5655 | 0.0242 |
| `dev-toggle-preference` | lamina | 0.6165 | 0.4199 | 0.75 | **0.6165** | 0.4199 | 0.75 | 0.3301 |

## Notes

- Seed 2: `dev-loan-library` plan first attempt had `trial_exception` (shape_build non-zero exit); re-ran same arm → valid (see `../logs/seed-2/NOTES.md`).
- Seed 3: `dev-review-room` lamina first attempt `AgentTimeoutError`; re-ran same arm → valid (see `../logs/seed-3/NOTES.md`).
- Harness unchanged between seeds (ABI-on-implement lamina path, budgets 240/360/600/300, judge `openai/gpt-5.5`).

