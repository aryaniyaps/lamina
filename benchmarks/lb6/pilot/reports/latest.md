# LaminaBench development pilot report

**Development-only / non-confirmatory.** Do not treat these cells as LaminaBench-6 evidence, a product-win advertisement, or a frozen statistical gate result.

- Generated: 2026-07-23T14:59:25.002Z
- Task: `dev-care-circle`
- Agent: `cursor-cli`
- Model: `cursor/composer-2.5`
- Attempts per arm: `1`
- Max retries after model invocation: `0`
- Concurrency requested: `6`
- Concurrency effective: `3`
- Concurrency hard max: `6`
- Campaign deadline: `2026-07-23T16:47:47.499Z`
- Campaign gate: `pilot_measurement_invalid`
- `child_actual_model_unverified: true`

## Limitations and missing gates

- Development-only pilot; not LaminaBench-6 confirmatory evidence.
- Persona child actual selected model remains unverified (`child_actual_model_unverified: true`).
- No effect-size gate, confidence interval, or product-win claim is computed or implied.
- Old Harbor V4 jobs/results are refused and never averaged into this report.
- Harbor publication remains a manual operator step.
- At least one arm lacks a valid final measurement; no three-arm comparison is computed.

## Arms

| Arm | State | Observed reward | Valid measurement | Duration ms | Job | Model evidence |
|---|---|---:|---|---:|---|---|
| direct | completed | 0.25 | yes | 175046 | `lb6-pilot-dev-care-circle-direct-1784818067499` | composer-2.5; child unverified |
| plan | completed | 0.25 | yes | 187546 | `lb6-pilot-dev-care-circle-plan-1784818067500` | composer-2.5; child unverified |
| lamina | trial_exception | n/a | no | 696853 | `lb6-pilot-dev-care-circle-lamina-1784818067501` | composer-2.5; child unverified |

## Failure states

- **lamina**: trial_exception

## Job paths

- direct: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-care-circle-direct-1784818067499`
- plan: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-care-circle-plan-1784818067500`
- lamina: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-care-circle-lamina-1784818067501`

## Publication

- Harbor publication was prepared but not executed by this runner.
- Operator must publish manually only after reviewing development gates.
