# LaminaBench development pilot report

**Development-only / non-confirmatory.** Do not treat these cells as LaminaBench-6 evidence, a product-win advertisement, or a frozen statistical gate result.

- Generated: 2026-07-24T14:48:30.838Z
- Selected tasks: `dev-toggle-preference`
- Agent: `cursor-cli`
- Model: `cursor/composer-2.5`
- Attempts per arm: `1`
- Max retries after model invocation: `0`
- Concurrency requested: `1`
- Concurrency effective: `1`
- Concurrency hard max: `6`
- Campaign deadline: `2026-07-24T16:35:11.763Z`
- Campaign gate: `three_arm_campaign_complete`
- Behavior rubric: `10` equal semantic points; raw score = `earned / 10`.
- Valid Harbor reward: arm-blind Laplace smoothing `(earned + 1) / 12` (ceiling `0.9167`).
- Deterministic replay: hard measurement-validity gate.
- `child_actual_model_unverified: true`

## Schedule

Deterministic makespan-aware order (development-only throughput optimization; not a confirmatory randomized schedule):

| Index | Wave | Task | Arm | Job |
|---:|---:|---|---|---|
| 0 | 1 | `dev-toggle-preference` | direct | `lb6-pilot-skill-rerun-v3-dev-toggle-preference-direct-1784903711763` |
| 1 | 1 | `dev-toggle-preference` | plan | `lb6-pilot-skill-rerun-v3-dev-toggle-preference-plan-1784903711764` |
| 2 | 1 | `dev-toggle-preference` | lamina | `lb6-pilot-skill-rerun-v3-dev-toggle-preference-lamina-1784903711765` |

## Task clusters

### `dev-toggle-preference`

| Arm | Reward | Raw | Earned | Valid measurement | Delta vs direct |
|---|---:|---:|---:|---|---|
| direct | 0.5 | n/a | n/a/n/a | yes | — |
| plan | 0.5413 | n/a | n/a/n/a | yes | 0.0413 |
| lamina | 0.6165 | n/a | n/a/n/a | yes | 0.11650000000000005 |

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

- dev-toggle-preference/direct: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-toggle-preference-direct-1784903711763`
- dev-toggle-preference/plan: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-toggle-preference-plan-1784903711764`
- dev-toggle-preference/lamina: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-toggle-preference-lamina-1784903711765`

## Publication

- Harbor publication was prepared but not executed by this runner.
- Operator must publish manually only after reviewing development gates.
