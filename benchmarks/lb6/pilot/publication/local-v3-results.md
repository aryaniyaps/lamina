# LB6 local v3 results (publish prep)

**Development-only / non-confirmatory.** Do not treat these cells as LaminaBench-6 confirmatory evidence, a product-win advertisement, or a frozen statistical gate result.

## Verdict

- Status: `ready_for_manual_publish`
- Campaign: `lb6-dev-pilot-skill-rerun-v3`
- Claim surface: `llm_judge` / measurement `llm_judge_v3`
- Judge mode: `openai_judge_only`
- Judge model: `gpt-4.1-2025-04-14`
- Generated: `2026-07-24T09:51:08.744Z`
- Completed measurement-valid cells: `12/12`
- Present jobs (any state): `12/12`
- Harbor CLI (host): `0.18.0`
- Harbor pin: `0.18.0`
- Agent: `cursor-cli`
- Model: `cursor/composer-2.5`
- Attempts per cell: `1`
- Source skill commit: `02aaebe3cd65459347d3b2e617fada0207874315`
- Harness commit: `0499598b7802b83944a68bfb9318550d07b66f4b`
- Harness clean (meaningful): `false`
- `child_actual_model_unverified: true`
- `development_only: true` / `confirmatory: false` / `marketing_claim_eligible: false`

## Reward matrix (LLM judge claim)

| Task | direct | plan | lamina |
|---|---:|---:|---:|
| `dev-loan-library` | 0.9534 | 1 | 1 |
| `dev-review-room` | 1 | 1 | 1 |
| `dev-simple-list` | 1 | 0.9534 | 1 |
| `dev-toggle-preference` | 0.9592 | 1 | 1 |

Primary rewards are host-side `llm_judge_v3` (OpenAI). Shown only when `measurementValid` is true.

## Semantic diagnostic matrix (not claim)

| Task | direct | plan | lamina |
|---|---:|---:|---:|
| `dev-loan-library` | 0.8333 | 0.8333 | 0.8333 |
| `dev-review-room` | 0.75 | 0.75 | 0.75 |
| `dev-simple-list` | 0.75 | 0.75 | 0.75 |
| `dev-toggle-preference` | 0.9167 | 0.9167 | 0.9167 |

Offline `semantic_criteria_v3` Laplace scores retained as diagnostic only.

## Per-task cells

### `dev-loan-library`

| Arm | Judge reward | Semantic | Earned | measurementValid | treatmentInvalid | State | Job |
|---|---:|---:|---:|---|---|---|---|
| direct | 0.9534 | 0.8333 | 9/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-loan-library-direct-1784862829243` |
| plan | 1 | 0.8333 | 9/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-loan-library-plan-1784862829244` |
| lamina | 1 | 0.8333 | 9/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-loan-library-lamina-1784862829242` |

### `dev-review-room`

| Arm | Judge reward | Semantic | Earned | measurementValid | treatmentInvalid | State | Job |
|---|---:|---:|---:|---|---|---|---|
| direct | 1 | 0.75 | 8/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-review-room-direct-1784863908901` |
| plan | 1 | 0.75 | 8/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-review-room-plan-1784863908902` |
| lamina | 1 | 0.75 | 8/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-review-room-lamina-1784863908903` |

### `dev-simple-list`

| Arm | Judge reward | Semantic | Earned | measurementValid | treatmentInvalid | State | Job |
|---|---:|---:|---:|---|---|---|---|
| direct | 1 | 0.75 | 8/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-simple-list-direct-1784864689137` |
| plan | 0.9534 | 0.75 | 8/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-simple-list-plan-1784864689138` |
| lamina | 1 | 0.75 | 8/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-simple-list-lamina-1784864689139` |

### `dev-toggle-preference`

| Arm | Judge reward | Semantic | Earned | measurementValid | treatmentInvalid | State | Job |
|---|---:|---:|---:|---|---|---|---|
| direct | 0.9592 | 0.9167 | 10/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-toggle-preference-direct-1784865310806` |
| plan | 1 | 0.9167 | 10/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-toggle-preference-plan-1784865310807` |
| lamina | 1 | 0.9167 | 10/10 | yes | no | `completed` | `lb6-pilot-skill-rerun-v3-dev-toggle-preference-lamina-1784865310808` |

## Job paths

- dev-loan-library/direct: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-loan-library-direct-1784862829243`
- dev-loan-library/plan: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-loan-library-plan-1784862829244`
- dev-loan-library/lamina: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-loan-library-lamina-1784862829242`
- dev-review-room/direct: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-review-room-direct-1784863908901`
- dev-review-room/plan: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-review-room-plan-1784863908902`
- dev-review-room/lamina: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-review-room-lamina-1784863908903`
- dev-simple-list/direct: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-simple-list-direct-1784864689137`
- dev-simple-list/plan: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-simple-list-plan-1784864689138`
- dev-simple-list/lamina: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-simple-list-lamina-1784864689139`
- dev-toggle-preference/direct: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-toggle-preference-direct-1784865310806`
- dev-toggle-preference/plan: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-toggle-preference-plan-1784865310807`
- dev-toggle-preference/lamina: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-toggle-preference-lamina-1784865310808`

## Triage log

- `2026-07-24T03:09:02.455Z` **dev-loan-library/lamina** state=`semantic_measurement_invalid` job=`lb6-pilot-skill-rerun-v3-dev-loan-library-lamina-1784862242073`
- `2026-07-24T03:12:09Z` **dev-loan-library/lamina** state=`trial_exception` job=`lb6-pilot-skill-rerun-v3-dev-loan-library-lamina-1784862242073` — Harbor VerifierResult rejected non-numeric reward.json keys (measurement/reward_transform). Fixed lb6_harbor_patch._numeric_harbor_rewards; re-running loan-library.
- `2026-07-24T03:13:45.431Z` **dev-loan-library/lamina** state=`trial_exception` job=`lb6-pilot-skill-rerun-v3-dev-loan-library-lamina-1784862242073` — 6 validation errors for VerifierResult
rewards.measurement.float
  Input should be a valid number, unable to parse string as a number [type=float_parsing, input_value='semantic_criteria_v3', input_type=str]
    For further information visit https://errors.pydantic.dev/2.13/v/float_parsing
rewards.measurement.int
  Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='semantic_criteria_v3', input_type=str]
    For further information visit https://errors.pydantic.dev/2.13/v/int_parsing
rewards.reward_transform.float
  Input should be a valid number, unable to parse string as a number [type=float_parsing, input_value='(earned + 1) / (possible + 2)', input_type=str]
    For further information visit https://errors.pydantic.dev/2.13/v/float_parsing
rewards.reward_transform.int
  Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='(earned + 1) / (possible + 2)', input_type=str]
    For further information visit https://errors.pydantic.dev/2.13/v/int_parsing
rewards.measurement_invalid_reason.float
  Input should be a valid number [type=float_type, input_value=None, input_type=NoneType]
    For further information visit https://errors.pydantic.dev/2.13/v/float_type
rewards.measurement_invalid_reason.int
  Input should be a valid integer [type=int_type, input_value=None, input_type=NoneType]
    For further information visit https://errors.pydantic.dev/2.13/v/int_type

## Limitations

- Development-only pilot; not LaminaBench-6 confirmatory evidence.
- Primary claim surface is host-side llm_judge_v3 (OpenAI); semantic_criteria_v3 is diagnostic only.
- Persona child actual selected model remains unverified (child_actual_model_unverified: true).
- No effect-size gate, confidence interval, or product-win claim is computed or implied.
- Collector includes only lb6-pilot-skill-rerun-v3 jobs for the four runnable tasks.
- Frozen dev-care-circle is excluded.
- Harbor publication remains a manual operator step.
- One attempt per cell for this local pass; ×3 attempts are out of scope here.

## Publication checklist

- [x] All 12 cells measurement-valid
- [x] Review `local-v3-results.md` / `.json` for triage blockers
- [ ] `harbor auth login` (or `HARBOR_API_KEY` in repo-root `.env`)
- [ ] Confirm frozen `dev-care-circle` is not republished from this package
- [ ] Run publish/upload commands below only after explicit approval

### Manual Harbor commands

- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-loan-library-direct-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-loan-library-lamina-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-loan-library-plan-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-review-room-direct-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-review-room-lamina-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-review-room-plan-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-simple-list-direct-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-simple-list-lamina-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-simple-list-plan-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-toggle-preference-direct-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-toggle-preference-lamina-v3`
- `harbor publish --public benchmarks/lb6/pilot/harbor/tasks-v3/dev-toggle-preference-plan-v3`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-loan-library-direct-1784862829243`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-loan-library-plan-1784862829244`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-loan-library-lamina-1784862829242`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-review-room-direct-1784863908901`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-review-room-plan-1784863908902`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-review-room-lamina-1784863908903`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-simple-list-direct-1784864689137`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-simple-list-plan-1784864689138`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-simple-list-lamina-1784864689139`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-toggle-preference-direct-1784865310806`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-toggle-preference-plan-1784865310807`
- `harbor upload --public jobs/lb6-pilot-skill-rerun-v3-dev-toggle-preference-lamina-1784865310808`

Blocked until: authenticated Harbor CLI + explicit approval to disclose a development-only package

- development-only package; not eligible for a confirmatory or marketing claim
- Cursor persona child actual selected model is unverified
- Harbor registry authentication is required for publish/upload
- frozen dev-care-circle package is excluded from this plan

