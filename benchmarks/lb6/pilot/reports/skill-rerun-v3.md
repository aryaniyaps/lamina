# LaminaBench development pilot report

**Development-only / non-confirmatory.** Do not treat these cells as LaminaBench-6 evidence, a product-win advertisement, or a frozen statistical gate result.

- Generated: 2026-07-24T13:05:00.350Z
- Selected tasks: `dev-simple-list`
- Agent: `cursor-cli`
- Model: `cursor/composer-2.5`
- Attempts per arm: `1`
- Max retries after model invocation: `0`
- Concurrency requested: `1`
- Concurrency effective: `1`
- Concurrency hard max: `6`
- Campaign deadline: `2026-07-24T14:50:31.050Z`
- Campaign gate: `three_arm_campaign_complete`
- Behavior rubric: `10` equal semantic points; raw score = `earned / 10`.
- Valid Harbor reward: arm-blind Laplace smoothing `(earned + 1) / 12` (ceiling `0.9167`).
- Deterministic replay: hard measurement-validity gate.
- `child_actual_model_unverified: true`

## Schedule

Deterministic makespan-aware order (development-only throughput optimization; not a confirmatory randomized schedule):

| Index | Wave | Task | Arm | Job |
|---:|---:|---|---|---|
| 0 | 1 | `dev-simple-list` | direct | `lb6-pilot-skill-rerun-v3-dev-simple-list-direct-1784897431050` |
| 1 | 1 | `dev-simple-list` | plan | `lb6-pilot-skill-rerun-v3-dev-simple-list-plan-1784897431051` |
| 2 | 1 | `dev-simple-list` | lamina | `lb6-pilot-skill-rerun-v3-dev-simple-list-lamina-1784897431052` |

## Task clusters

### `dev-simple-list`

| Arm | Reward | Raw | Earned | Valid measurement | Delta vs direct |
|---|---:|---:|---:|---|---|
| direct | 0.318 | n/a | n/a/n/a | yes | — |
| plan | 0.5121 | n/a | n/a/n/a | yes | 0.1941 |
| lamina | 0.5413 | n/a | n/a/n/a | yes | 0.2233 |

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

- dev-simple-list/direct: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-simple-list-direct-1784897431050`
- dev-simple-list/plan: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-simple-list-plan-1784897431051`
- dev-simple-list/lamina: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-simple-list-lamina-1784897431052`

## Publication

- Harbor publication was prepared but not executed by this runner.
- Operator must publish manually only after reviewing development gates.
