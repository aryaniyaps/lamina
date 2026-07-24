# LB6 local v3 LLM-judge run (in-trial)

**Development-only / non-confirmatory.** In-trial host OpenAI judge (`LB6_LLM_JUDGE=1`). Distinct from post-hoc `local-v3-results.*`.

## Verdict

- Status: `blocked`
- Campaign: `lb6-dev-pilot-skill-rerun-v3`
- Results artifact: `local-v3-llm-judge-run`
- Claim surface: `llm_judge` / measurement `llm_judge_v3`
- Judge mode: `openai_judge_only_in_trial`
- Judge model: `gpt-5.5`
- Campaign started: `2026-07-24T09:57:52.253Z`
- Min job ts: `1784887072253`
- Generated: `2026-07-24T10:07:41.647Z`
- Completed measurement-valid cells: `0/12`
- Present jobs (any state): `1/12`
- Harbor CLI (host): `0.18.0`
- Harbor pin: `0.18.0`
- Agent: `cursor-cli`
- Model: `cursor/composer-2.5`
- `child_actual_model_unverified: true`
- `development_only: true` / `confirmatory: false` / `marketing_claim_eligible: false`

## Reward matrix (in-trial LLM judge claim)

| Task | direct | plan | lamina |
|---|---:|---:|---:|
| `dev-loan-library` | — | — | — |
| `dev-review-room` | — | — | — |
| `dev-simple-list` | — | — | — |
| `dev-toggle-preference` | — | — | — |

## Semantic diagnostic matrix (not claim)

| Task | direct | plan | lamina |
|---|---:|---:|---:|
| `dev-loan-library` | — | — | 0.8333 |
| `dev-review-room` | — | — | — |
| `dev-simple-list` | — | — | — |
| `dev-toggle-preference` | — | — | — |

## Per-task cells

### `dev-loan-library`

| Arm | Judge | Semantic | In-trial | Valid | State | Job |
|---|---:|---:|---|---|---|---|
| direct | — | — | no | no | `pending` | `pending` |
| plan | — | — | no | no | `pending` | `pending` |
| lamina | — | 0.8333 | no | no | `trial_exception` | `lb6-pilot-skill-rerun-v3-dev-loan-library-lamina-1784887077747` |

### `dev-review-room`

| Arm | Judge | Semantic | In-trial | Valid | State | Job |
|---|---:|---:|---|---|---|---|
| direct | — | — | no | no | `pending` | `pending` |
| plan | — | — | no | no | `pending` | `pending` |
| lamina | — | — | no | no | `pending` | `pending` |

### `dev-simple-list`

| Arm | Judge | Semantic | In-trial | Valid | State | Job |
|---|---:|---:|---|---|---|---|
| direct | — | — | no | no | `pending` | `pending` |
| plan | — | — | no | no | `pending` | `pending` |
| lamina | — | — | no | no | `pending` | `pending` |

### `dev-toggle-preference`

| Arm | Judge | Semantic | In-trial | Valid | State | Job |
|---|---:|---:|---|---|---|---|
| direct | — | — | no | no | `pending` | `pending` |
| plan | — | — | no | no | `pending` | `pending` |
| lamina | — | — | no | no | `pending` | `pending` |

## Job paths

- dev-loan-library/direct: `pending`
- dev-loan-library/plan: `pending`
- dev-loan-library/lamina: `/Users/shiv/Desktop/code2/lamina/jobs/lb6-pilot-skill-rerun-v3-dev-loan-library-lamina-1784887077747`
- dev-review-room/direct: `pending`
- dev-review-room/plan: `pending`
- dev-review-room/lamina: `pending`
- dev-simple-list/direct: `pending`
- dev-simple-list/plan: `pending`
- dev-simple-list/lamina: `pending`
- dev-toggle-preference/direct: `pending`
- dev-toggle-preference/plan: `pending`
- dev-toggle-preference/lamina: `pending`

## Triage log

- `2026-07-24T10:07:41.647Z` **dev-loan-library/lamina** state=`trial_exception` job=`lb6-pilot-skill-rerun-v3-dev-loan-library-lamina-1784887077747` — in-trial llm_judge_complete ledger event missing

## Limitations

- Development-only pilot; not LaminaBench-6 confirmatory evidence.
- Primary claim surface is in-trial host llm_judge_v3 (OpenAI); semantic_criteria_v3 is diagnostic only.
- This artifact is distinct from post-hoc local-v3-results.* rescore files.
- Persona child actual selected model remains unverified.
- Harbor publication remains a manual operator step.

## Publication checklist

- [ ] All 12 cells in-trial measurement-valid
- [ ] Review `local-v3-llm-judge-run.md` / `.json`
- [ ] `harbor auth login` (or `HARBOR_API_KEY` in repo-root `.env`)
- [ ] Confirm frozen `dev-care-circle` is not republished
- [ ] Run publish/upload only after explicit approval

### Manual Harbor commands

_No publication commands yet._

