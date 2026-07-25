# LB6 Issue #18 — RewardKit development pilot

**Harbor dataset:** `shiv-eshwar/lb6-dev-pilot-issue18-rewardkit`  
**Hub:** https://hub.harborframework.com/datasets/shiv-eshwar/lb6-dev-pilot-issue18-rewardkit

Development-only · non-confirmatory · not marketing-claim-eligible.

## What’s in this dataset

12 public tasks = 4 product tasks × 3 arms (`direct`, `plan`, `lamina`):

| Task | Arms |
|---|---|
| `dev-loan-library` | direct · plan · lamina |
| `dev-review-room` | direct · plan · lamina |
| `dev-simple-list` | direct · plan · lamina |
| `dev-toggle-preference` | direct · plan · lamina |

- **Judge:** Harbor RewardKit (`openai/gpt-5.5`) on `/app/app.mjs` + `/app/ui.mjs` only  
- **Published claim (repo):** per-cell **median of 3 seeds**  
- **Not included:** `/lamina-verify` as a Harbor step; host-sealed private verifier

## How to run (from Harbor Hub)

```bash
# Auth + env (judge + Cursor agent)
# OPENAI_API_KEY, REWARDKIT_JUDGE=openai/gpt-5.5, LITELLM_DROP_PARAMS=1
# CURSOR_API_KEY

harbor run \
  -d shiv-eshwar/lb6-dev-pilot-issue18-rewardkit@latest \
  -a cursor-cli \
  -m cursor/composer-2.5 \
  --env-file .env \
  -n 1
```

Pinned tag from this publish: `@issue18-rewardkit-median-n3` (also `@latest`).

Run concurrency `-n 1` is recommended for cleaner logs; raise only if you accept Harbor race/cost tradeoffs.

For **bit-for-bit pilot parity** (skill bundle staging, campaign collect, 3-seed median), use the repo protocol:  
[`benchmarks/lb6/pilot/publication/REPRODUCE.md`](https://github.com/aryaniyaps/lamina/blob/main/benchmarks/lb6/pilot/publication/REPRODUCE.md)

## Results (what we got)

- **Writeup / median table (source of truth):**  
  https://github.com/aryaniyaps/lamina/blob/main/benchmarks/lb6/pilot/publication/local-v3-issue18-rewardkit-median.md
- **36 public seed jobs** (3 full matrices): listed in-repo at  
  `benchmarks/lb6/pilot/publication/harbor-job-urls.tsv`
- Example job: https://hub.harborframework.com/jobs/68bf74a0-fed5-4533-ab1a-051885720931

## Fair reading

OK: under this development pilot harness, lamina’s **median** score is above plan and direct on all four tasks.

Not OK: confirmatory LaminaBench-6 proof; that `.lamina/` process quality was graded; that every seed matched the same deltas.
