# LaminaBench v2.0.0 / v2.1 Release

## What changed from v1.1 → v2.0 → v2.1

| Area | v1.1 | v2.0 | v2.1 |
|------|------|------|------|
| Positioning | UX-quality | Product-behavior in code | Same; **narrowed claim surface** |
| Composite | Unused | 40/40/20 (+ human) | **50/50 checklist + LLM judge** |
| Human | Synthetic | In composite | Optional qualitative only |
| Behavior probes | — | Scaffolding | Structural probes + analyst pass |
| Cost/time | — | — | Reported from `index.jsonl` |
| Claim wording | Briefs | Mixed briefs/source | **Checklist + LLM rubric on source** |

## Results status

**No committed live results yet.** After a successful live run with `claim_ready: true`:

```bash
npm run bench:all
cp benchmarks/results/report.md benchmarks/releases/v2.0.0/
cp benchmarks/results/statistics/stats.json benchmarks/releases/v2.0.0/
```

## Claim wording

Use only when `stats.json` has `"claim_ready": true`:

> On LaminaBench (Design A — ecological adoption), the same coding agent with Lamina scored higher than Plan mode + implement on reference-checklist coverage and multi-model rubric scores of implemented source. Treatment includes Lamina’s verify/fix loop by design (5 phases); control stops after implement (2 phases). Wall-clock/token cost and structural behavior-probe lift are reported separately.

Until then:

> LaminaBench defines a public ecological adoption A/B with a claim surface of checklist + LLM rubric on implemented source. Live results are not yet published.
