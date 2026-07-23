# LaminaBench development pilot report

**Development-only / non-confirmatory.** Do not treat these cells as LaminaBench-6 evidence, a product-win advertisement, or a frozen statistical gate result.

- Generated: 2026-07-23T15:21:21.255Z
- Task: `dev-care-circle`
- Agent: `cursor-cli`
- Model: `cursor/composer-2.5`
- Attempts per arm: `1`
- Max retries after model invocation: `0`
- Concurrency requested: `6`
- Concurrency effective: `3`
- Concurrency hard max: `6`
- Campaign deadline: `2026-07-23T17:10:09.908Z`
- Campaign gate: `three_arm_campaign_complete`
- `child_actual_model_unverified: true`

## Limitations and missing gates

- Development-only pilot; not LaminaBench-6 confirmatory evidence.
- Persona child actual selected model remains unverified (`child_actual_model_unverified: true`).
- No effect-size gate, confidence interval, or product-win claim is computed or implied.
- Old Harbor V4 jobs/results are refused and never averaged into this report.
- Harbor publication remains a manual operator step.

## Arms

| Arm | State | Observed reward | Valid measurement | Duration ms | Job | Model evidence |
|---|---|---:|---|---:|---|---|
| direct | completed | 0.5 | yes | 216958 | `lb6-pilot-dev-care-circle-direct-1784819409908` | composer-2.5; child unverified |
| plan | completed | 0.25 | yes | 172546 | `lb6-pilot-dev-care-circle-plan-1784819409909` | composer-2.5; child unverified |
| lamina | completed | 0.75 | yes | 670741 | `lb6-pilot-dev-care-circle-lamina-1784819409910` | composer-2.5; child unverified |

## Failure states

- None recorded as non-completed (still development-only; not a product claim).

## Job paths

- direct: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-care-circle-direct-1784819409908`
- plan: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-care-circle-plan-1784819409909`
- lamina: `/home/aryan/ai-projects/lamina/jobs/lb6-pilot-dev-care-circle-lamina-1784819409910`

## Publication

- Harbor publication was prepared but not executed by this runner.
- Operator must publish manually only after reviewing development gates.
