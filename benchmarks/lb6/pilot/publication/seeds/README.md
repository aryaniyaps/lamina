# Per-seed packages — Lamina Product Coding Pilot

Each seed is one full 4-task × 3-arm matrix under the **same frozen harness** (LLM-judge, ABI-on-implement lamina path).

| Seed | Files | Run notes |
|---|---|---|
| 1 | `seed-1-issue18-rewardkit.{md,json,campaign.json}` | [`RUN_NOTES.md`](./RUN_NOTES.md) |
| 2 | `seed-2-issue18-rewardkit.{md,json,campaign.json}` | 1 cell retry documented |
| 3 | `seed-3-issue18-rewardkit.{md,json,campaign.json}` | 1 cell retry documented |

**Publish / claim table:** median across these three seeds →  
[`../local-v3-issue18-rewardkit-median.md`](../local-v3-issue18-rewardkit-median.md)

**How to reproduce / archive / recompute:** [`../REPRODUCE.md`](../REPRODUCE.md)

```bash
# freeze live collect → seed-N (refuses overwrite)
node benchmarks/lb6/pilot/scripts/archive-issue18-seed.mjs --seed N

# recompute median from seeds/
npm run bench:lb6:v3:median-issue18
```

Do not overwrite seed files when collecting a new campaign; archive into the next `seed-N-*` slot instead. Local tee logs may live under `../../logs/seed-N/` (gitignored).

*(Filenames keep `issue18-rewardkit` for provenance; public name is Lamina Product Coding Pilot.)*
