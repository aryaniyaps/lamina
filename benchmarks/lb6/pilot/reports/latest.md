# LaminaBench development pilot report

**Development-only / non-confirmatory.** Do not treat these cells as LaminaBench-6 evidence, a product-win advertisement, or a frozen statistical gate result.

- Generated: 2026-07-23T16:35:10.892Z
- Selected tasks: `dev-loan-library`, `dev-review-room`, `dev-simple-list`
- Agent: `cursor-cli`
- Model: `cursor/composer-2.5`
- Attempts per arm: `1`
- Max retries after model invocation: `0`
- Concurrency requested: `6`
- Concurrency effective: `6`
- Concurrency hard max: `6`
- Campaign deadline: `2026-07-23T18:24:35.731Z`
- Campaign gate: `pilot_measurement_invalid`
- `child_actual_model_unverified: true`

## Schedule

Deterministic makespan-aware order (development-only throughput optimization; not a confirmatory randomized schedule):

| Index | Wave | Task | Arm | Job |
|---:|---:|---|---|---|
| 0 | 1 | `dev-loan-library` | lamina | `lb6-pilot-dev-loan-library-lamina-1784823875731` |
| 1 | 1 | `dev-review-room` | lamina | `lb6-pilot-dev-review-room-lamina-1784823875732` |
| 2 | 1 | `dev-simple-list` | lamina | `lb6-pilot-dev-simple-list-lamina-1784823875733` |
| 3 | 1 | `dev-loan-library` | direct | `lb6-pilot-dev-loan-library-direct-1784823875734` |
| 4 | 1 | `dev-loan-library` | plan | `lb6-pilot-dev-loan-library-plan-1784823875735` |
| 5 | 1 | `dev-review-room` | direct | `lb6-pilot-dev-review-room-direct-1784823875736` |
| 6 | 2 | `dev-review-room` | plan | `lb6-pilot-dev-review-room-plan-1784823875737` |
| 7 | 2 | `dev-simple-list` | direct | `lb6-pilot-dev-simple-list-direct-1784823875738` |
| 8 | 2 | `dev-simple-list` | plan | `lb6-pilot-dev-simple-list-plan-1784823875739` |

## Task clusters

### `dev-loan-library`

| Arm | Reward | Valid measurement | Delta vs direct |
|---|---:|---|---|
| direct | 0 | yes | — |
| plan | 0.3333 | yes | 0.3333 |
| lamina | n/a | no | n/a |

### `dev-review-room`

| Arm | Reward | Valid measurement | Delta vs direct |
|---|---:|---|---|
| direct | 0.3333 | yes | — |
| plan | 0.6667 | yes | 0.3334 |
| lamina | n/a | no | n/a |

### `dev-simple-list`

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
- Schedule order is deterministic makespan-aware optimization, not a confirmatory randomized arm schedule.
- At least one selected task/arm cell lacks a valid final measurement; no cross-arm comparison is computed.

## Failure states

- **dev-loan-library/lamina**: trial_exception
- **dev-review-room/lamina**: trial_exception

## Job paths

- dev-loan-library/lamina: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-loan-library-lamina-1784823875731`
- dev-review-room/lamina: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-review-room-lamina-1784823875732`
- dev-simple-list/lamina: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-simple-list-lamina-1784823875733`
- dev-loan-library/direct: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-loan-library-direct-1784823875734`
- dev-loan-library/plan: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-loan-library-plan-1784823875735`
- dev-review-room/direct: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-review-room-direct-1784823875736`
- dev-review-room/plan: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-review-room-plan-1784823875737`
- dev-simple-list/direct: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-simple-list-direct-1784823875738`
- dev-simple-list/plan: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-simple-list-plan-1784823875739`

## Publication

- Harbor publication was prepared but not executed by this runner.
- Operator must publish manually only after reviewing development gates.
