# LaminaBench v2.0.0 Release

## What changed from v1.1

| Area | v1.1 | v2.0 |
|------|------|------|
| Positioning | UX-quality benchmark | Product-behavior design benchmark |
| Golden schema | personas, flows, rules, a11y | + invariants, entities, scenarios, trade-offs |
| Category 5 | accessibility | resilience (offline, session, network, empty states; a11y as one task) |
| Audit findings | UX heuristics only | + invariant violations, state consistency, permission gaps |
| Rubric | 10 UX-doc criteria | 10 product-behavior criteria |
| Coverage weights | Flat | Invariants/scenarios 2×; sections **not scored** (format-neutral) |
| Prompts | "Design the core UX…" | Product-behavior brief + shared output contract |
| Artifact capture | Full `.lamina/` dump | Preferred brief files only (volume-debiased) |
| Mock path | Default `bench:all` | Separated to `bench:pipeline-check` only |
| Composite | Documented, unused | Computed in `analyze.py` (40/40/20) |
| Human scores | Synthetic from coverage | CSV import only for claims |

## Results status

**No committed live results yet.** After a successful live run with `claim_ready: true`:

```bash
npm run bench:all
npm run bench:import-human -- --csv path/to/rater-scores.csv
npm run bench:analyze
cp benchmarks/results/report.md benchmarks/releases/v2.0.0/
cp benchmarks/results/statistics/stats.json benchmarks/releases/v2.0.0/
```

## Claim wording

Use only when `stats.json` has `"claim_ready": true`:

> On a public 25-task product-behavior design benchmark spanning greenfield design, OSS feature design, OSS behavior audits, workflow edge cases, and resilience challenges, the same coding agent with Lamina produced higher-quality product design briefs than the agent alone — measured by reference-checklist coverage, multi-judge rubric scores, and blind human evaluation on a 10-task stratified subset.

Until then:

> LaminaBench v2.0 defines a public A/B protocol for product-behavior design brief quality. Live results are not yet published.
