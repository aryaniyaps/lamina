# LaminaBench development pilot report

**Development-only / non-confirmatory.** Do not treat these cells as LaminaBench-6 evidence, a product-win advertisement, or a frozen statistical gate result.

- Generated: 2026-07-23T19:18:51.861Z
- Selected tasks: `dev-loan-library`, `dev-review-room`, `dev-simple-list`, `dev-toggle-preference`
- Agent: `cursor-cli`
- Model: `cursor/composer-2.5`
- Attempts per arm: `1`
- Max retries after model invocation: `0`
- Concurrency requested: `6`
- Concurrency effective: `6`
- Concurrency hard max: `6`
- Campaign deadline: `2026-07-23T20:41:20.121Z`
- Campaign gate: `three_arm_campaign_complete`
- `child_actual_model_unverified: true`

## Schedule

Deterministic makespan-aware order (development-only throughput optimization; not a confirmatory randomized schedule):

| Index | Wave | Task | Arm | Job |
|---:|---:|---|---|---|
| 0 | 1 | `dev-loan-library` | lamina | `lb6-pilot-skill-rerun-v2-dev-loan-library-lamina-1784832080121` |
| 1 | 1 | `dev-loan-library` | direct | `lb6-pilot-skill-rerun-v2-dev-loan-library-direct-1784832080122` |
| 2 | 1 | `dev-loan-library` | plan | `lb6-pilot-skill-rerun-v2-dev-loan-library-plan-1784832080123` |
| 3 | 1 | `dev-review-room` | direct | `lb6-pilot-skill-rerun-v2-dev-review-room-direct-1784832080124` |
| 4 | 1 | `dev-review-room` | plan | `lb6-pilot-skill-rerun-v2-dev-review-room-plan-1784832080125` |
| 5 | 1 | `dev-simple-list` | direct | `lb6-pilot-skill-rerun-v2-dev-simple-list-direct-1784832080126` |
| 6 | 2 | `dev-review-room` | lamina | `lb6-pilot-skill-rerun-v2-dev-review-room-lamina-1784832080127` |
| 7 | 2 | `dev-simple-list` | plan | `lb6-pilot-skill-rerun-v2-dev-simple-list-plan-1784832080128` |
| 8 | 2 | `dev-toggle-preference` | direct | `lb6-pilot-skill-rerun-v2-dev-toggle-preference-direct-1784832080129` |
| 9 | 2 | `dev-toggle-preference` | plan | `lb6-pilot-skill-rerun-v2-dev-toggle-preference-plan-1784832080130` |
| 10 | 3 | `dev-simple-list` | lamina | `lb6-pilot-skill-rerun-v2-dev-simple-list-lamina-1784832080131` |
| 11 | 4 | `dev-toggle-preference` | lamina | `lb6-pilot-skill-rerun-v2-dev-toggle-preference-lamina-1784832080132` |

## Task clusters

### `dev-loan-library`

| Arm | Reward | Valid measurement | Delta vs direct |
|---|---:|---|---|
| direct | 0 | yes | — |
| plan | 0.6667 | yes | 0.6667 |
| lamina | 0 | yes | 0 |

### `dev-review-room`

| Arm | Reward | Valid measurement | Delta vs direct |
|---|---:|---|---|
| direct | 0 | yes | — |
| plan | 0.3333 | yes | 0.3333 |
| lamina | 1 | yes | 1 |

### `dev-simple-list`

| Arm | Reward | Valid measurement | Delta vs direct |
|---|---:|---|---|
| direct | 0 | yes | — |
| plan | 0 | yes | 0 |
| lamina | 1 | yes | 1 |

### `dev-toggle-preference`

| Arm | Reward | Valid measurement | Delta vs direct |
|---|---:|---|---|
| direct | 0 | yes | — |
| plan | 0 | yes | 0 |
| lamina | 0 | yes | 0 |

## Limitations and missing gates

- Development-only pilot; not LaminaBench-6 confirmatory evidence.
- Persona child actual selected model remains unverified (`child_actual_model_unverified: true`).
- No effect-size gate, confidence interval, or product-win claim is computed or implied.
- Old Harbor V4 jobs/results are refused and never averaged into this report.
- Harbor publication remains a manual operator step.
- Schedule order is deterministic admission-aware optimization with at most one Lamina parent, not a confirmatory randomized arm schedule.
- Prior Lamina efficacy deltas from no-skill Harbor locks are treatment-invalid and are suppressed from lamina_minus_* deltas.

## Failure states

- None recorded as non-completed (still development-only; not a product claim).

## Job paths

- dev-loan-library/lamina: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-loan-library-lamina-1784832080121`
- dev-loan-library/direct: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-loan-library-direct-1784832080122`
- dev-loan-library/plan: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-loan-library-plan-1784832080123`
- dev-review-room/direct: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-review-room-direct-1784832080124`
- dev-review-room/plan: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-review-room-plan-1784832080125`
- dev-simple-list/direct: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-simple-list-direct-1784832080126`
- dev-review-room/lamina: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-review-room-lamina-1784832080127`
- dev-simple-list/plan: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-simple-list-plan-1784832080128`
- dev-toggle-preference/direct: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-toggle-preference-direct-1784832080129`
- dev-toggle-preference/plan: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-toggle-preference-plan-1784832080130`
- dev-simple-list/lamina: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-simple-list-lamina-1784832080131`
- dev-toggle-preference/lamina: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-skill-rerun-v2-dev-toggle-preference-lamina-1784832080132`

## Publication

- Harbor publication was executed after the complete 12-cell report passed the publication boundary.
- All 12 task packages and all 12 eligible v2 jobs are public; 24/24 public URLs returned HTTP 200.
- Receipt: `benchmarks/lb6/pilot/publication/publication-result-skill-rerun-v2.json`.
- Aborted v1 and pre-model v2 jobs were not uploaded.
