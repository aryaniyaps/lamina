#!/usr/bin/env python3
"""
LaminaBench statistical analysis (stdlib only).
Reads golden coverage, judge, and human scores; emits report.md + stats.json
including the documented 40/40/20 composite when layers are present.
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
RELEASE_YAML = ROOT / "benchmarks/release.yaml"
METHODOLOGY_JSON = ROOT / "benchmarks/methodology.json"

DEFAULT_WEIGHTS = {
    "golden_coverage": 0.4,
    "llm_judge": 0.4,
    "human_eval": 0.2,
}


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
    t_crit = 2.045 if n >= 25 else 2.776 if n <= 5 else 2.1
    return m - t_crit * se, m + t_crit * se


def cohens_d(control: list[float], treatment: list[float]) -> float:
    delta = [t - c for c, t in zip(control, treatment)]
    sd = stdev(delta)
    if sd == 0:
        return 0.0
    return (mean(treatment) - mean(control)) / sd


def wilcoxon_signed_rank(control: list[float], treatment: list[float]) -> tuple[float | None, float | None]:
    diffs = [t - c for c, t in zip(control, treatment)]
    non_zero = [d for d in diffs if d != 0]
    if len(non_zero) < 2:
        return None, None
    pos = sum(1 for d in non_zero if d > 0)
    n = len(non_zero)
    expected = n / 2
    z = (pos - expected) / math.sqrt(n * 0.25) if n > 0 else 0
    p = 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))
    return float(pos), float(p)


def load_methodology() -> dict:
    if not METHODOLOGY_JSON.exists():
        return {}
    return json.loads(METHODOLOGY_JSON.read_text())


def methodology_report_section(methodology: dict) -> list[str]:
    if not methodology:
        return []
    control = methodology.get("control", {})
    treatment = methodology.get("treatment", {})
    lines = [
        "## Methodology (Design A — ecological adoption)",
        "",
        f"- **Id:** `{methodology.get('id', 'unknown')}` — {methodology.get('name', '')}",
        f"- **Research question:** {methodology.get('research_question', '').strip()}",
        f"- **Control:** {control.get('label', '')} ({control.get('phases', '?')} phases, scored {control.get('scoring_checkpoint', '')})",
        f"- **Treatment:** {treatment.get('label', '')} ({treatment.get('phases', '?')} phases, scored {treatment.get('scoring_checkpoint', '')})",
        "",
        "**Why unequal turns is intentional (not a scoring loophole):**",
        "",
    ]
    for item in methodology.get("why_unequal_turns_is_correct", []):
        lines.append(f"- {item}")
    lines.extend([
        "",
        "Full rationale: `benchmarks/METHODOLOGY.md` · Machine pin: `benchmarks/methodology.json`",
        "",
        "**Do not reinterpret** these results as matched-turn ablation unless a separate benchmark variant is run and published.",
        "",
    ])
    return lines


def load_json(path: Path) -> list[dict]:
    return json.loads(path.read_text())


def load_weights() -> dict[str, float]:
    if not RELEASE_YAML.exists():
        return dict(DEFAULT_WEIGHTS)
    text = RELEASE_YAML.read_text()
    weights = dict(DEFAULT_WEIGHTS)
    in_block = False
    for line in text.splitlines():
        if line.strip().startswith("scoring_weights:"):
            in_block = True
            continue
        if in_block:
            if line and not line.startswith(" ") and not line.startswith("\t"):
                break
            if ":" in line:
                key, val = line.strip().split(":", 1)
                try:
                    weights[key.strip()] = float(val.strip())
                except ValueError:
                    pass
    return weights


def task_level_means(rows: list[dict], score_col: str) -> dict[str, dict[str, float]]:
    buckets: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if score_col not in r or r[score_col] is None:
            continue
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


def human_task_means(human: dict) -> dict[str, dict[str, float]]:
    """Build per-task arm means from imported human ratings."""
    ratings = human.get("ratings") or []
    buckets: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for r in ratings:
        if "arm" not in r or "overall_product_behavior" not in r:
            continue
        buckets[r["task_id"]][r["arm"]].append(float(r["overall_product_behavior"]))
    out: dict[str, dict[str, float]] = {}
    for task_id, arms in buckets.items():
        if "control" in arms and "treatment" in arms:
            out[task_id] = {
                "control": mean(arms["control"]),
                "treatment": mean(arms["treatment"]),
            }
    return out


def normalize_coverage(score: float) -> float:
    """Map 0–100 coverage to 1–5 rubric scale for composite."""
    return 1.0 + (max(0.0, min(100.0, score)) / 100.0) * 4.0


def compute_composite(
    cov_pairs: dict[str, dict[str, float]],
    judge_pairs: dict[str, dict[str, float]] | None,
    human_pairs: dict[str, dict[str, float]] | None,
    weights: dict[str, float],
) -> dict | None:
    """
    Per-task composite on 1–5 scale using available layers.
    Renormalizes weights when human (or judge) layer is missing.
    """
    tasks = set(cov_pairs)
    if judge_pairs:
        tasks &= set(judge_pairs)
    if not tasks:
        return None

    w_cov = weights.get("golden_coverage", 0.4)
    w_judge = weights.get("llm_judge", 0.4)
    w_human = weights.get("human_eval", 0.2)

    composite_pairs: dict[str, dict[str, float]] = {}
    layers_used = ["golden_coverage"]
    if judge_pairs:
        layers_used.append("llm_judge")
    use_human = bool(human_pairs)
    if use_human:
        layers_used.append("human_eval")

    for task_id in sorted(tasks):
        arm_scores: dict[str, float] = {}
        for arm in ("control", "treatment"):
            parts = []
            wsum = 0.0
            parts.append((normalize_coverage(cov_pairs[task_id][arm]), w_cov))
            wsum += w_cov
            if judge_pairs and task_id in judge_pairs:
                parts.append((judge_pairs[task_id][arm], w_judge))
                wsum += w_judge
            if use_human and human_pairs and task_id in human_pairs:
                parts.append((human_pairs[task_id][arm], w_human))
                wsum += w_human
            elif use_human:
                # Task not in human subset — renormalize without human
                pass
            arm_scores[arm] = sum(v * w for v, w in parts) / wsum if wsum else 0.0
        if "control" in arm_scores and "treatment" in arm_scores:
            composite_pairs[task_id] = arm_scores

    if not composite_pairs:
        return None

    stats = paired_stats(composite_pairs)
    stats["layers"] = layers_used
    stats["weights"] = {k: weights[k] for k in layers_used if k in weights}
    stats["scale"] = "1-5"
    return stats


def build_report(
    coverage_stats: dict,
    judge_stats: dict | None,
    human: dict | None,
    composite_stats: dict | None,
    claim_ready: bool,
    methodology: dict | None = None,
) -> str:
    lines = [
        "# LaminaBench v2.0 Report",
        "",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "",
    ]

    if not claim_ready:
        lines.extend([
            "> **Not claim-ready.** Live non-mock runs, real LLM judge (or disclosed heuristic),",
            "> and non-synthetic human scores (when citing the 20% human layer) are required",
            "> before any external citation of these numbers.",
            "",
        ])

    if methodology:
        lines.extend(methodology_report_section(methodology))

    lines.extend([
        "## Golden Coverage (Objective reference checklist)",
        "",
        f"- Control mean: **{coverage_stats['control_mean']:.1f}** (σ={coverage_stats['control_std']:.1f})",
        f"- Treatment mean: **{coverage_stats['treatment_mean']:.1f}** (σ={coverage_stats['treatment_std']:.1f})",
        f"- Mean delta (treatment − control): **{coverage_stats['mean_delta']:+.1f}**",
        f"- 95% CI: [{coverage_stats['ci_95_low']:+.1f}, {coverage_stats['ci_95_high']:+.1f}]",
        f"- Cohen's d: **{coverage_stats['cohens_d']:.2f}**",
    ])
    if coverage_stats.get("wilcoxon_p") is not None:
        lines.append(f"- Wilcoxon signed-rank p-value: {coverage_stats['wilcoxon_p']:.4f}")
    lines.append(f"- Paired tasks: {coverage_stats['n_pairs']}")
    lines.append("- Note: Goldens are a reference checklist, not ground truth. `required_sections` are not scored.")

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
        synthetic = human.get("synthetic", True)
        lines.extend([
            "",
            "## Human Evaluation (10-task subset)",
            "",
            f"- Fleiss' κ: **{human.get('fleiss_kappa', 'N/A')}**",
            f"- Control mean overall: {human.get('control_mean', 'N/A')}",
            f"- Treatment mean overall: {human.get('treatment_mean', 'N/A')}",
            f"- Source: {'synthetic (not for claims)' if synthetic else human.get('source', 'import')}",
            f"- Note: {human.get('note', '')}",
        ])

    if composite_stats:
        lines.extend([
            "",
            "## Composite score (documented weights)",
            "",
            f"- Layers: {', '.join(composite_stats.get('layers', []))}",
            f"- Weights: {composite_stats.get('weights', {})}",
            f"- Control mean (1–5): **{composite_stats['control_mean']:.2f}**",
            f"- Treatment mean (1–5): **{composite_stats['treatment_mean']:.2f}**",
            f"- Mean delta: **{composite_stats['mean_delta']:+.2f}**",
            f"- Cohen's d: **{composite_stats['cohens_d']:.2f}**",
            f"- Paired tasks: {composite_stats['n_pairs']}",
        ])

    lines.extend([
        "",
        "## Interpretation",
        "",
        "Positive mean delta: Lamina full loop vs Plan + implement (ecological adoption methodology).",
        "Unequal agent turns are **by design** — see Methodology section above; not equal-turn ablation.",
        "Control scored post-implement; treatment post-fix. Golden coverage searches implementation source.",
        "",
        "## Reproducibility",
        "",
        "See `benchmarks/release.yaml` for pinned agent and model configuration.",
        "Raw artifacts: `benchmarks/results/raw/`. Scored outputs: `benchmarks/results/scored/`.",
        "Release path: `npm run bench:all` (live). Pipeline check: `npm run bench:pipeline-check` (mock).",
    ])
    return "\n".join(lines) + "\n"


def detect_claim_ready(coverage_rows: list[dict], human: dict | None, judge_rows: list[dict] | None) -> bool:
    if any(r.get("mock") for r in coverage_rows):
        return False
    if human and human.get("synthetic", False):
        return False
    if judge_rows:
        modes = {((r.get("judge_scores") or {}).get("judge_mode")) for r in judge_rows}
        if modes == {"heuristic"}:
            return False
    return True


def main() -> None:
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    weights = load_weights()
    methodology = load_methodology()

    coverage_rows = load_json(SCORED_DIR / "coverage-summary.json")
    cov_pairs = task_level_means(coverage_rows, "coverage_score")
    cov_stats = paired_stats(cov_pairs)

    judge_stats = None
    judge_pairs = None
    judge_rows = None
    judge_path = SCORED_DIR / "judge-summary.json"
    if judge_path.exists():
        judge_rows = load_json(judge_path)
        judge_pairs = task_level_means(judge_rows, "judge_mean")
        if judge_pairs:
            judge_stats = paired_stats(judge_pairs)

    human = None
    human_pairs = None
    human_path = SCORED_DIR / "human-scores.json"
    if human_path.exists():
        human = json.loads(human_path.read_text())
        if not human.get("synthetic", True):
            human_pairs = human_task_means(human)
        # Still show synthetic human in report but exclude from composite

    composite_stats = compute_composite(cov_pairs, judge_pairs, human_pairs, weights)
    claim_ready = detect_claim_ready(coverage_rows, human, judge_rows)

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
        "claim_ready": claim_ready,
        "methodology": methodology,
        "scoring_weights": weights,
        "coverage": cov_stats,
        "judge": judge_stats,
        "human": human,
        "composite": composite_stats,
        "by_category": by_category,
    }

    stats_path = STATS_DIR / "stats.json"
    stats_path.write_text(json.dumps(out, indent=2) + "\n")
    report_path = RESULTS_DIR / "report.md"
    report_path.write_text(build_report(cov_stats, judge_stats, human, composite_stats, claim_ready, methodology))

    print(f"Statistics → {stats_path}")
    print(f"Report → {report_path}")
    print(f"Coverage delta: {cov_stats['mean_delta']:+.1f} (d={cov_stats['cohens_d']:.2f})")
    if composite_stats:
        print(f"Composite delta: {composite_stats['mean_delta']:+.2f} (d={composite_stats['cohens_d']:.2f})")
    print(f"Claim-ready: {claim_ready}")


if __name__ == "__main__":
    main()
