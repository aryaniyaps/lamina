# LaminaBench Release Snapshots

Published benchmark results for each release tag (`bench-v2.0.0`, etc.).

Unlike `benchmarks/results/` (gitignored working directory), release snapshots here are committed for reproducibility.

## v2.0.0

- **Tag:** `bench-v2.0.0`
- **Tasks:** 25 (5 per category)
- **Categories:** greenfield, oss_feature, oss_audit, workflow_edge, **resilience**
- **Scoring:** Product-behavior briefs — invariants, entities, scenarios, trade-offs (2×); sections not scored
- **Runs:** 3 control + 3 treatment per task
- **Status:** Protocol claim-hardened. **Live agent run + Anthropic LLM judge** required before any external claims (`claim_ready: true` in stats.json). Human review is optional qualitative only — not in the composite.

See `v2.0.0/README.md`.

## Reproducing v2.0.0

```bash
npm run bench:validate
npm run bench:env-check
npm run bench:all
# optional: npm run bench:import-human -- --csv scores.csv
# commit under releases/v2.0.0/ only if claim_ready: true
git tag bench-v2.0.0
```
