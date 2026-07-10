# LaminaBench v2.0.0 Release

## What changed from v1.1

| Area | v1.1 | v2.0 |
|------|------|------|
| Positioning | UX-quality benchmark | Product-behavior design benchmark |
| Golden schema | personas, flows, rules, a11y | + invariants, entities, scenarios, trade-offs |
| Category 5 | accessibility | resilience (offline, session, network, empty states; a11y as one task) |
| Audit findings | UX heuristics only | + invariant violations, state consistency, permission gaps |
| Rubric | 10 UX-doc criteria | 10 product-behavior criteria |
| Coverage weights | Flat | Invariants/scenarios 2×; a11y 1× |

## Results status

**No committed results yet.** v2.0.0 updates the measurement target. Run a live agent benchmark before publishing scores:

```bash
npm run bench:validate
npm run bench:run
npm run bench:score
npm run bench:analyze
```

Copy `benchmarks/results/statistics/stats.json` and `benchmarks/results/report.md` here after a successful live run.

## Claim wording

> On a public 25-task product-behavior design benchmark spanning greenfield design, OSS feature design, OSS behavior audits, workflow edge cases, and resilience challenges, the same coding agent with Lamina produced higher-quality product design contracts than the agent alone.
