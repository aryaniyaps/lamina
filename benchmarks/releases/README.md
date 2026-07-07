# LaminaBench Release Snapshots

Published benchmark results for each release tag (`bench-v1.1.0`, etc.).

Unlike `benchmarks/results/` (gitignored working directory), release snapshots here are committed for reproducibility.

## v1.1.0

- **Tag:** `bench-v1.1.0`
- **Tasks:** 25 (5 per category)
- **Runs:** 3 control + 3 treatment per task
- **Mode:** Mock pipeline validation run (replace with live agent run for production leaderboard)

See `v1.1.0/report.md` and `v1.1.0/stats.json`.

## Reproducing

```bash
npm run bench:validate
npm run bench:run          # or --mock for offline pipeline test
npm run bench:score
npm run bench:analyze
npm run bench:human-packet
git tag bench-v1.1.0
```
