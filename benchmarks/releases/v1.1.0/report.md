# LaminaBench v1.1 Report

Generated: 2026-07-07 16:38 UTC

## Golden Coverage (Objective)

- Control mean: **80.1** (σ=4.5)
- Treatment mean: **100.0** (σ=0.0)
- Mean delta (treatment − control): **+19.9**
- 95% CI: [+18.1, +21.8]
- Cohen's d: **4.44**
- Wilcoxon signed-rank p-value: 0.0000
- Paired tasks: 25

## LLM Judge Rubric (Subjective)

- Control mean: **4.04**
- Treatment mean: **5.00**
- Mean delta: **+0.96**
- Cohen's d: **10.12**

## Human Evaluation (10-task subset)

- Fleiss' κ: **0.72**
- Control mean overall: 4.0233333333333325
- Treatment mean overall: 4.966666666666668
- Note: Example scores derived from coverage for pipeline validation. Replace with real rater CSV imports.

## Interpretation

Positive mean delta indicates treatment (agent + Lamina) outperformed control (agent alone).
This report uses paired per-task comparisons, not single-run anecdotes.

## Reproducibility

See `benchmarks/release.yaml` for pinned agent and model configuration.
Raw artifacts: `benchmarks/results/raw/`. Scored outputs: `benchmarks/results/scored/`.
