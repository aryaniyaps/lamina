# LaminaBench Release Snapshots

Published benchmark results for each release tag (`bench-v2.0.0`, etc.).

Unlike `benchmarks/results/` (gitignored working directory), release snapshots here are committed for reproducibility.

## v2.0.0

- **Tag:** `bench-v2.0.0`
- **Tasks:** 25 (5 per category)
- **Categories:** greenfield, oss_feature, oss_audit, workflow_edge, **resilience** (replaces accessibility)
- **Scoring:** Product-behavior contracts — invariants, entities, scenarios, trade-offs (weighted 2× vs a11y)
- **Runs:** 3 control + 3 treatment per task
- **Status:** Schema and corpus updated. **Live agent run required** before any external claims.

See `v2.0.0/README.md`.

## v1.1.0 (retired for claims)

v1.1.0 used UX-doc goldens and mock pipeline results. **Do not cite v1.1.0 numbers externally.** Historical snapshot preserved in `v1.1.0/` for comparison only.

## Reproducing v2.0.0

```bash
npm run bench:validate
npm run bench:run          # live run required for production leaderboard
npm run bench:score
npm run bench:analyze
npm run bench:human-packet
git tag bench-v2.0.0
```
