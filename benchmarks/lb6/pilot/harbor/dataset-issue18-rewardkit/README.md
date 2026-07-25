# Lamina Product Coding Pilot — 3-arm (direct / plan / lamina)

**Harbor dataset:** `shiv-eshwar/lb6-dev-pilot-issue18-rewardkit`  
**Hub:** https://hub.harborframework.com/datasets/shiv-eshwar/lb6-dev-pilot-issue18-rewardkit

Compares three ways to build small product apps with the same agent and judge:

| Arm | What it means |
|---|---|
| `direct` | Code straight from the brief |
| `plan` | Short plan, then code |
| `lamina` | Lamina skills (`/lamina-init` + `/lamina-design`), then code |

**Development-only** · not confirmatory LaminaBench-6 · not a marketing claim.

## What’s in this dataset

12 public tasks = 4 product tasks × 3 arms:

| Task | Arms |
|---|---|
| loan-library | direct · plan · lamina |
| review-room | direct · plan · lamina |
| simple-list | direct · plan · lamina |
| toggle-preference | direct · plan · lamina |

- **Scored on:** product source `/app/app.mjs` + `/app/ui.mjs` (LLM-as-judge)  
- **Published claim (repo):** per-cell **median of 3 full re-runs**  
- **Not scored:** `.lamina/` process notes; no `/lamina-verify` step in this pilot  

*(Internals for operators: Harbor RewardKit judge `openai/gpt-5.5`; GitHub issue #18 shape.)*

## How to run

```bash
# Needs: CURSOR_API_KEY, OPENAI_API_KEY, REWARDKIT_JUDGE=openai/gpt-5.5, LITELLM_DROP_PARAMS=1

harbor run \
  -d shiv-eshwar/lb6-dev-pilot-issue18-rewardkit@latest \
  -a cursor-cli \
  -m cursor/composer-2.5 \
  --env-file .env \
  -n 1
```

Pinned tag: `@issue18-rewardkit-median-n3` (same content as `latest` at publish time).

For the full local 3-seed / median protocol:  
[`benchmarks/lb6/pilot/publication/REPRODUCE.md`](https://github.com/aryaniyaps/lamina/blob/main/benchmarks/lb6/pilot/publication/REPRODUCE.md)

## Results (what we got)

- **Median writeup:**  
  https://github.com/aryaniyaps/lamina/blob/main/benchmarks/lb6/pilot/publication/local-v3-issue18-rewardkit-median.md
- **36 public run jobs** (3 full matrices):  
  `benchmarks/lb6/pilot/publication/harbor-job-urls.tsv`
- Example job: https://hub.harborframework.com/jobs/68bf74a0-fed5-4533-ab1a-051885720931
