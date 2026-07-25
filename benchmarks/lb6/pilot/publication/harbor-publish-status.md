# Harbor publish — Lamina Product Coding Pilot (3-arm)

**Status: complete** — share pack: dataset → run command → public jobs → writeup.

| Artifact | Count | Visibility |
|---|---:|---|
| Tasks | 12 | public |
| Seed jobs | 36 (3 × 12) | public |
| Dataset | 1 | public |

Published under Harbor user **`shiv-eshwar`** (display name below; registry id unchanged).

**Public name:** Lamina Product Coding Pilot — 3-arm (direct / plan / lamina)  
**Scope:** development-only · non-confirmatory · not marketing-claim-eligible  
*(Operator note: Issue #18 / RewardKit / LB6 pilot internals.)*

---

## 1) Dataset URL — “here’s the benchmark”

https://hub.harborframework.com/datasets/shiv-eshwar/lb6-dev-pilot-issue18-rewardkit

- Id: `shiv-eshwar/lb6-dev-pilot-issue18-rewardkit` (stable; do not rename casually)
- Tags: `latest`, `issue18-rewardkit-median-n3`
- Contents: 12 tasks (4 × direct/plan/lamina)

Local package: [`../harbor/dataset-issue18-rewardkit/`](../harbor/dataset-issue18-rewardkit/)

---

## 2) How to run

```bash
harbor run \
  -d shiv-eshwar/lb6-dev-pilot-issue18-rewardkit@latest \
  -a cursor-cli \
  -m cursor/composer-2.5 \
  --env-file .env \
  -n 1
```

Env: `CURSOR_API_KEY`, `OPENAI_API_KEY`, `REWARDKIT_JUDGE=openai/gpt-5.5`, `LITELLM_DROP_PARAMS=1`.

Full local 3-seed / median protocol: [`REPRODUCE.md`](./REPRODUCE.md).

---

## 3) Result jobs (public) — “here’s what we got”

**36/36** seed jobs uploaded public. Map: [`harbor-job-urls.tsv`](./harbor-job-urls.tsv)

Example: https://hub.harborframework.com/jobs/68bf74a0-fed5-4533-ab1a-051885720931

---

## 4) Writeup / median — interpretation in git

- Median table: [`local-v3-issue18-rewardkit-median.md`](./local-v3-issue18-rewardkit-median.md)
- Claim index: [`README.md`](./README.md)
- Seeds + retries: [`seeds/`](./seeds/), [`seeds/RUN_NOTES.md`](./seeds/RUN_NOTES.md)

Means (median matrix): lamina **0.6893** · plan **0.5589** · direct **0.5856**

---

## Tasks (also public)

- https://hub.harborframework.com/tasks/shiv-eshwar/dev-loan-library-direct-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-loan-library-plan-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-loan-library-lamina-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-review-room-direct-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-review-room-plan-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-review-room-lamina-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-simple-list-direct-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-simple-list-plan-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-simple-list-lamina-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-toggle-preference-direct-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-toggle-preference-plan-v3
- https://hub.harborframework.com/tasks/shiv-eshwar/dev-toggle-preference-lamina-v3
