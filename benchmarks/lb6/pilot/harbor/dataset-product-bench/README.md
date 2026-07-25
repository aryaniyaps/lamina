# Product Bench — 3-arm (direct / plan / lamina)

**Harbor dataset:** `lamina/product-bench`  
**Hub:** https://hub.harborframework.com/datasets/lamina/product-bench

Compares three ways to build small product apps with the same agent and judge:

| Arm | What it means |
|---|---|
| `direct` | Code straight from the brief |
| `plan` | Short plan, then code |
| `lamina` | Lamina skills (`/lamina-init` + `/lamina-design`), then code |

Initial public Product Bench release. Under this benchmark harness, Lamina’s median score exceeded the direct and plan-first arms on all four tasks. This release covers small greenfield vertical slices only; it does not establish performance on larger applications, brownfield projects, or other models.

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

## How to run

```bash
# Needs: CURSOR_API_KEY, OPENAI_API_KEY, REWARDKIT_JUDGE=openai/gpt-5.5, LITELLM_DROP_PARAMS=1

harbor run \
  -d lamina/product-bench@latest \
  -a cursor-cli \
  -m cursor/composer-2.5 \
  --env-file .env \
  -n 1
```

Pinned tag: `@product-bench-median-n3` (same content as `latest` at publish time).

For the full local 3-seed / median protocol:  
[`benchmarks/lb6/pilot/publication/REPRODUCE.md`](https://github.com/aryaniyaps/lamina/blob/main/benchmarks/lb6/pilot/publication/REPRODUCE.md)

## Results (what we got)

- **Median writeup:**  
  https://github.com/aryaniyaps/lamina/blob/main/benchmarks/lb6/pilot/publication/local-v3-issue18-rewardkit-median.md
- **36 public run jobs** (3 full matrices):  
  `benchmarks/lb6/pilot/publication/harbor-job-urls.tsv`
- Example job: https://hub.harborframework.com/jobs/68bf74a0-fed5-4533-ab1a-051885720931
