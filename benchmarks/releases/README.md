# LaminaBench Release Snapshots

Published benchmark results for each release tag (`bench-v2.0.0`, etc.).

Unlike `benchmarks/results/` (gitignored working directory), release snapshots here are committed for reproducibility.

## v2.0.0

- **Tag:** `bench-v2.0.0`
- **Tasks:** 25 (5 per category)
- **Categories:** greenfield, oss_feature, oss_audit, workflow_edge, **resilience**
- **Scoring:** Product-behavior briefs — invariants, entities, scenarios, trade-offs (2×); sections not scored
- **Runs:** 3 control + 3 treatment per task
- **Status:** Protocol claim-hardened. **Live agent run + real human import required** before any external claims (`claim_ready: true` in stats.json).

See `v2.0.0/README.md`.

## v1.1.0 (retired for claims)

v1.1.0 used UX-doc goldens and mock pipeline results. **Do not cite v1.1.0 numbers externally.** Historical snapshot preserved in `v1.1.0/` for comparison only.

## Reproducing v2.0.0

```bash
npm run bench:validate
npm run bench:all              # live — never use mock for release
npm run bench:import-human -- --csv scores.csv
npm run bench:analyze
# commit under releases/v2.0.0/ only if claim_ready: true
git tag bench-v2.0.0
```

Pipeline validation (not for claims): `npm run bench:pipeline-check`
