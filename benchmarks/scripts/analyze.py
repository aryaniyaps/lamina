#!/usr/bin/env python3
"""
LaminaBench statistical analysis (stdlib only).
Reads golden coverage scores and optional judge/human scores; emits report.md + stats.json.
"""
from __future__ import annotations

import json
import math
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCORED_DIR = ROOT / "benchmarks/results/scored"
STATS_DIR = ROOT / "benchmarks/results/statistics"
RESULTS_DIR = ROOT / "benchmarks/results"


def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def stdev(xs: list[float]) -> float:
    return statistics.stdev(xs) if len(xs) > 1 else 0.0


def t_ci_95(delta: list[float]) -> tuple[float, float]:
    n = len(delta)
    if n < 2:
        m = mean(delta) if delta else 0.0
        return m, m
    m = mean(delta)
    se = stdev(delta) / math.sqrt(n)
    # t ~ 2 for n>=10; use 2.045 for n=30, 2.776 for n=5
    t_crit = 2.045 if n >= 25 else 2.776 if n <= 5 else 2.1
    return m - t_crit * se, m + t_crit * se


def cohens_d(control: list[float], treatment: list[float]) -> float:
    delta = [t - c for c, t in zip(control, treatment)]
    sd = stdev(delta)
    if sd == 0:
        return 0.0
    return (mean(treatment) - mean(control)) / sd


def wilcoxon_signed_rank(control: list[float], treatment: list[float]) -> tuple[float | None, float | None]:
    """Approximate Wilcoxon via sign test when scipy unavailable."""
    diffs = [t - c for c, t in zip(control, treatment)]
    non_zero = [d for d in diffs if d != 0]
    if len(non_zero) < 2:
        return None, None
    pos = sum(1 for d in non_zero if d > 0)
    n = len(non_zero)
    # Binomial test approximation
    expected = n / 2
    z = (pos - expected) / math.sqrt(n * 0.25) if n > 0 else 0
    # two-tailed normal approx p-value
    p = 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))
    return float(pos), float(p)


def load_json(path: Path) -> list[dict]:
    return json.loads(path.read_text())


def task_level_means(rows: list[dict], score_col: str) -> dict[str, dict[str, float]]:
    buckets: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        buckets[r["task_id"]][r["arm"]].append(float(r[score_col]))
    out: dict[str, dict[str, float]] = {}
    for task_id, arms in buckets.items():
        if "control" in arms and "treatment" in arms:
            out[task_id] = {
                "control": mean(arms["control"]),
                "treatment": mean(arms["treatment"]),
            }
    return out


def paired_stats(pairs: dict[str, dict[str, float]]) -> dict:
    control = [v["control"] for v in pairs.values()]
    treatment = [v["treatment"] for v in pairs.values()]
    delta = [t - c for c, t in zip(control, treatment)]
    ci_lo, ci_hi = t_ci_95(delta)
    wstat, wp = wilcoxon_signed_rank(control, treatment)
    return {
        "control_mean": mean(control),
        "treatment_mean": mean(treatment),
        "control_std": stdev(control),
        "treatment_std": stdev(treatment),
        "mean_delta": mean(delta),
        "median_delta": statistics.median(delta) if delta else 0,
        "ci_95_low": ci_lo,
        "ci_95_high": ci_hi,
        "cohens_d": cohens_d(control, treatment),
        "wilcoxon_stat": wstat,
        "wilcoxon_p": wp,
        "n_pairs": len(delta),
    }


def build_report(coverage_stats: dict, judge_stats: dict | None, human: dict | None) -> str:
    lines = [
        "# LaminaBench v2.0 Report",
        "",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "## Golden Coverage (Objective)",
        "",
        f"- Control mean: **{coverage_stats['control_mean']:.1f}** (σ={coverage_stats['control_std']:.1f})",
        f"- Treatment mean: **{coverage_stats['treatment_mean']:.1f}** (σ={coverage_stats['treatment_std']:.1f})",
        f"- Mean delta (treatment − control): **{coverage_stats['mean_delta']:+.1f}**",
        f"- 95% CI: [{coverage_stats['ci_95_low']:+.1f}, {coverage_stats['ci_95_high']:+.1f}]",
        f"- Cohen's d: **{coverage_stats['cohens_d']:.2f}**",
    ]
    if coverage_stats.get("wilcoxon_p") is not None:
        lines.append(f"- Wilcoxon signed-rank p-value: {coverage_stats['wilcoxon_p']:.4f}")
    lines.append(f"- Paired tasks: {coverage_stats['n_pairs']}")

    if judge_stats:
        lines.extend([
            "",
            "## LLM Judge Rubric (Subjective)",
            "",
            f"- Control mean: **{judge_stats['control_mean']:.2f}**",
            f"- Treatment mean: **{judge_stats['treatment_mean']:.2f}**",
            f"- Mean delta: **{judge_stats['mean_delta']:+.2f}**",
            f"- Cohen's d: **{judge_stats['cohens_d']:.2f}**",
        ])

    if human:
        lines.extend([
            "",
            "## Human Evaluation (10-task subset)",
            "",
            f"- Fleiss' κ: **{human.get('fleiss_kappa', 'N/A')}**",
            f"- Control mean overall: {human.get('control_mean', 'N/A')}",
            f"- Treatment mean overall: {human.get('treatment_mean', 'N/A')}",
            f"- Note: {human.get('note', '')}",
            "",
            "v2 scores product-behavior contracts (domain, invariants, scenarios) — not UX research docs.",
        ])

    lines.extend([
        "",
        "## Interpretation",
        "",
        "Positive mean delta indicates treatment (agent + Lamina) outperformed control (agent alone).",
        "This report uses paired per-task comparisons, not single-run anecdotes.",
        "",
        "## Reproducibility",
        "",
        "See `benchmarks/release.yaml` for pinned agent and model configuration.",
        "Raw artifacts: `benchmarks/results/raw/`. Scored outputs: `benchmarks/results/scored/`.",
    ])
    return "\n".join(lines) + "\n"


def main() -> None:
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    coverage_rows = load_json(SCORED_DIR / "coverage-summary.json")
    cov_pairs = task_level_means(coverage_rows, "coverage_score")
    cov_stats = paired_stats(cov_pairs)

    judge_stats = None
    judge_path = SCORED_DIR / "judge-summary.json"
    if judge_path.exists():
        judge_rows = load_json(judge_path)
        judge_pairs = task_level_means(judge_rows, "judge_mean")
        if judge_pairs:
            judge_stats = paired_stats(judge_pairs)

    human = None
    human_path = SCORED_DIR / "human-scores.json"
    if human_path.exists():
        human = json.loads(human_path.read_text())

    by_category: dict = {}
    cat_tasks: dict[str, list[dict]] = defaultdict(list)
    for r in coverage_rows:
        cat_tasks[r["category"]].append(r)
    for cat, rows in cat_tasks.items():
        pairs = task_level_means(rows, "coverage_score")
        if pairs:
            by_category[cat] = paired_stats(pairs)

    out = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "coverage": cov_stats,
        "judge": judge_stats,
        "human": human,
        "by_category": by_category,
    }

    stats_path = STATS_DIR / "stats.json"
    stats_path.write_text(json.dumps(out, indent=2) + "\n")
    report_path = RESULTS_DIR / "report.md"
    report_path.write_text(build_report(cov_stats, judge_stats, human))

    print(f"Statistics → {stats_path}")
    print(f"Report → {report_path}")
    print(f"Coverage delta: {cov_stats['mean_delta']:+.1f} (d={cov_stats['cohens_d']:.2f})")


if __name__ == "__main__":
    main()
