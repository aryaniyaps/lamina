#!/usr/bin/env python3
"""
LaminaBench statistical analysis (stdlib only).

Primary composite (v2.1): golden coverage 50% + LLM judge 50% on implemented source.
Optional layers (reported, not in composite): behavior probes, cost/time, human qualitative.
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
RAW_DIR = ROOT / "benchmarks/results/raw"
RELEASE_YAML = ROOT / "benchmarks/release.yaml"
METHODOLOGY_JSON = ROOT / "benchmarks/methodology.json"

# Human eval is optional qualitative only — not part of the claim composite.
DEFAULT_WEIGHTS = {
    "golden_coverage": 0.5,
    "llm_judge": 0.5,
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


def normalize_coverage(score: float) -> float:
    """Map 0–100 coverage to 1–5 rubric scale for composite."""
    return 1.0 + (max(0.0, min(100.0, score)) / 100.0) * 4.0


def compute_composite(
    cov_pairs: dict[str, dict[str, float]],
    judge_pairs: dict[str, dict[str, float]] | None,
    weights: dict[str, float],
) -> dict | None:
    """
    Per-task composite on 1–5 scale: golden coverage + LLM judge only.
    Human and probes are reported separately (not in claim composite).
    """
    tasks = set(cov_pairs)
    if judge_pairs:
        tasks &= set(judge_pairs)
    if not tasks:
        return None

    w_cov = weights.get("golden_coverage", 0.5)
    w_judge = weights.get("llm_judge", 0.5)
    # Human eval and behavior probes are reported separately — not in composite
    layers_used = ["golden_coverage"]
    if judge_pairs:
        layers_used.append("llm_judge")

    composite_pairs: dict[str, dict[str, float]] = {}
    for task_id in sorted(tasks):
        arm_scores: dict[str, float] = {}
        for arm in ("control", "treatment"):
            parts = [(normalize_coverage(cov_pairs[task_id][arm]), w_cov)]
            wsum = w_cov
            if judge_pairs and task_id in judge_pairs:
                parts.append((judge_pairs[task_id][arm], w_judge))
                wsum += w_judge
            arm_scores[arm] = sum(v * w for v, w in parts) / wsum if wsum else 0.0
        if "control" in arm_scores and "treatment" in arm_scores:
            composite_pairs[task_id] = arm_scores

    if not composite_pairs:
        return None

    stats = paired_stats(composite_pairs)
    stats["layers"] = layers_used
    stats["weights"] = {k: weights.get(k, 0) for k in layers_used}
    stats["scale"] = "1-5"
    stats["excluded_from_composite"] = ["behavior_probes", "human_optional"]
    return stats


def load_index_cost() -> dict | None:
    index_path = RAW_DIR / "index.jsonl"
    if not index_path.exists():
        return None
    rows = [
        json.loads(line)
        for line in index_path.read_text().splitlines()
        if line.strip()
    ]
    if not rows:
        return None

    by_arm: dict[str, list[float]] = defaultdict(list)
    tokens_by_arm: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        arm = r.get("arm", "control")
        if r.get("duration_ms") is not None:
            by_arm[arm].append(float(r["duration_ms"]))
        tok = r.get("total_tokens") or r.get("tokens")
        if tok is not None:
            tokens_by_arm[arm].append(float(tok))

    def arm_stats(vals: list[float]) -> dict:
        return {
            "mean_ms": mean(vals),
            "median_ms": statistics.median(vals) if vals else 0,
            "total_ms": sum(vals),
            "n": len(vals),
        }

    out: dict = {
        "duration": {
            "control": arm_stats(by_arm.get("control", [])),
            "treatment": arm_stats(by_arm.get("treatment", [])),
        },
        "note": "Wall-clock from index.jsonl. Token fields populated when the agent CLI reports usage.",
    }
    if tokens_by_arm:
        out["tokens"] = {
            arm: {
                "mean": mean(vals),
                "total": sum(vals),
                "n": len(vals),
            }
            for arm, vals in tokens_by_arm.items()
        }
        # Rough USD estimate from release.yaml-ish Sonnet rates if present
        # $3/M input + $15/M output is unknown split — report tokens only unless cost_usd set
    costs = [r.get("cost_usd") for r in rows if r.get("cost_usd") is not None]
    if costs:
        out["cost_usd_total"] = sum(float(c) for c in costs)
    # Lift-style duration delta
    if by_arm.get("control") and by_arm.get("treatment"):
        c = mean(by_arm["control"])
        t = mean(by_arm["treatment"])
        out["duration"]["mean_delta_ms"] = t - c
        out["duration"]["treatment_over_control_ratio"] = (t / c) if c else None
    return out


def build_report(
    coverage_stats: dict,
    judge_stats: dict | None,
    probe_stats: dict | None,
    cost: dict | None,
    human: dict | None,
    composite_stats: dict | None,
    analyst: dict | None,
    claim_ready: bool,
    methodology: dict | None = None,
) -> str:
    lines = [
        "# LaminaBench v2.1 Report",
        "",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "**Claim surface:** checklist coverage + LLM rubric on implemented source (Design A).",
        "Behavior probes, cost/time, and human review are reported separately — not in the composite.",
        "",
    ]

    if not claim_ready:
        lines.extend([
            "> **Not claim-ready.** Live non-mock runs and a real LLM judge (not heuristic-only)",
            "> are required before any external citation of these numbers.",
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

    if composite_stats:
        lines.extend([
            "",
            "## Composite score (claim surface)",
            "",
            f"- Layers: {', '.join(composite_stats.get('layers', []))}",
            f"- Weights: {composite_stats.get('weights', {})}",
            f"- Excluded: {', '.join(composite_stats.get('excluded_from_composite', []))}",
            f"- Control mean (1–5): **{composite_stats['control_mean']:.2f}**",
            f"- Treatment mean (1–5): **{composite_stats['treatment_mean']:.2f}**",
            f"- Mean delta: **{composite_stats['mean_delta']:+.2f}**",
            f"- Cohen's d: **{composite_stats['cohens_d']:.2f}**",
            f"- Paired tasks: {composite_stats['n_pairs']}",
        ])

    if probe_stats:
        lines.extend([
            "",
            "## Behavior probes (separate — not in composite)",
            "",
            f"- Control mean: **{probe_stats['control_mean']:.1f}**",
            f"- Treatment mean: **{probe_stats['treatment_mean']:.1f}**",
            f"- Mean delta (skill_lift-style): **{probe_stats['mean_delta']:+.1f}**",
            f"- Cohen's d: **{probe_stats['cohens_d']:.2f}**",
            f"- Paired tasks: {probe_stats['n_pairs']}",
            "- Structural source probes (code_guard / entity_model / scenario_handler).",
        ])

    if cost:
        dur = cost.get("duration") or {}
        c = dur.get("control") or {}
        t = dur.get("treatment") or {}
        lines.extend([
            "",
            "## Cost / time",
            "",
            f"- Control mean wall-clock: **{c.get('mean_ms', 0):.0f} ms** (n={c.get('n', 0)})",
            f"- Treatment mean wall-clock: **{t.get('mean_ms', 0):.0f} ms** (n={t.get('n', 0)})",
        ])
        if dur.get("mean_delta_ms") is not None:
            lines.append(f"- Mean duration delta (treatment − control): **{dur['mean_delta_ms']:+.0f} ms**")
        if dur.get("treatment_over_control_ratio") is not None:
            lines.append(f"- Treatment/control duration ratio: **{dur['treatment_over_control_ratio']:.2f}×**")
        if cost.get("tokens"):
            for arm, tok in cost["tokens"].items():
                lines.append(f"- {arm} tokens: mean={tok.get('mean', 0):.0f}, total={tok.get('total', 0):.0f}")
        if cost.get("cost_usd_total") is not None:
            lines.append(f"- Total cost_usd (when reported by runner): **${cost['cost_usd_total']:.4f}**")
        lines.append(f"- Note: {cost.get('note', '')}")

    if analyst:
        g = analyst.get("golden_coverage") or {}
        p = analyst.get("behavior_probes") or {}
        lines.extend([
            "",
            "## Analyst pass (non-discriminating items)",
            "",
            f"- Golden always-pass-both: {len(g.get('always_pass_both') or [])}; "
            f"always-fail-both: {len(g.get('always_fail_both') or [])}; "
            f"discriminating: {len(g.get('discriminating') or [])}",
            f"- Probes always-pass-both: {len(p.get('always_pass_both') or [])}; "
            f"always-fail-both: {len(p.get('always_fail_both') or [])}; "
            f"discriminating: {len(p.get('discriminating') or [])}",
            "- See `results/scored/analyst-report.json` for item lists.",
        ])

    if human:
        synthetic = human.get("synthetic", True)
        lines.extend([
            "",
            "## Human review (optional qualitative — not in composite)",
            "",
            f"- Fleiss' κ: **{human.get('fleiss_kappa', 'N/A')}**",
            f"- Control mean overall: {human.get('control_mean', 'N/A')}",
            f"- Treatment mean overall: {human.get('treatment_mean', 'N/A')}",
            f"- Source: {'synthetic (not for claims)' if synthetic else human.get('source', 'import')}",
            f"- Note: {human.get('note', 'Optional appendix only; excluded from claim composite.')}",
        ])

    lines.extend([
        "",
        "## Interpretation",
        "",
        "Positive mean delta on the composite: higher checklist + LLM-rubric scores on implemented source",
        "for Lamina full loop vs Plan + implement (ecological adoption methodology).",
        "Unequal agent turns are **by design** — see Methodology section; not equal-turn ablation.",
        "Behavior-probe lift is a separate SkillsBench-style signal — do not fold into the composite claim",
        "until probes include runtime oracles you trust.",
        "",
        "## Reproducibility",
        "",
        "See `benchmarks/release.yaml` for pinned agent and model configuration.",
        "Raw artifacts: `benchmarks/results/raw/`. Scored outputs: `benchmarks/results/scored/`.",
        "Release path: `npm run bench:all` (live). Pipeline check: `npm run bench:pipeline-check` (mock).",
    ])
    return "\n".join(lines) + "\n"


def detect_claim_ready(coverage_rows: list[dict], judge_rows: list[dict] | None) -> bool:
    if any(r.get("mock") for r in coverage_rows):
        return False
    if judge_rows:
        modes = {((r.get("judge_scores") or {}).get("judge_mode")) for r in judge_rows}
        if modes == {"heuristic"}:
            return False
    else:
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

    probe_stats = None
    probe_path = SCORED_DIR / "probes-summary.json"
    if probe_path.exists():
        probe_rows = load_json(probe_path)
        probe_pairs = task_level_means(probe_rows, "probe_score")
        if probe_pairs:
            probe_stats = paired_stats(probe_pairs)

    human = None
    human_path = SCORED_DIR / "human-scores.json"
    if human_path.exists():
        human = json.loads(human_path.read_text())

    analyst = None
    analyst_path = SCORED_DIR / "analyst-report.json"
    if analyst_path.exists():
        analyst = json.loads(analyst_path.read_text())

    cost = load_index_cost()
    composite_stats = compute_composite(cov_pairs, judge_pairs, weights)
    claim_ready = detect_claim_ready(coverage_rows, judge_rows)

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
        "claim_surface": "golden_coverage + llm_judge on implemented source (Design A)",
        "methodology": methodology,
        "scoring_weights": weights,
        "coverage": cov_stats,
        "judge": judge_stats,
        "behavior_probes": probe_stats,
        "cost": cost,
        "human_optional": human,
        "analyst": {
            "golden_non_discriminating_rate": (analyst or {}).get("golden_coverage", {}).get(
                "non_discriminating_rate"
            ),
            "probe_non_discriminating_rate": (analyst or {}).get("behavior_probes", {}).get(
                "non_discriminating_rate"
            ),
        }
        if analyst
        else None,
        "composite": composite_stats,
        "by_category": by_category,
    }

    stats_path = STATS_DIR / "stats.json"
    stats_path.write_text(json.dumps(out, indent=2) + "\n")
    report_path = RESULTS_DIR / "report.md"
    report_path.write_text(
        build_report(
            cov_stats,
            judge_stats,
            probe_stats,
            cost,
            human,
            composite_stats,
            analyst,
            claim_ready,
            methodology,
        )
    )

    print(f"Statistics → {stats_path}")
    print(f"Report → {report_path}")
    print(f"Coverage delta: {cov_stats['mean_delta']:+.1f} (d={cov_stats['cohens_d']:.2f})")
    if probe_stats:
        print(f"Probe lift: {probe_stats['mean_delta']:+.1f} (d={probe_stats['cohens_d']:.2f})")
    if composite_stats:
        print(f"Composite delta: {composite_stats['mean_delta']:+.2f} (d={composite_stats['cohens_d']:.2f})")
    if cost and cost.get("duration", {}).get("mean_delta_ms") is not None:
        print(f"Duration delta: {cost['duration']['mean_delta_ms']:+.0f} ms")
    print(f"Claim-ready: {claim_ready}")


if __name__ == "__main__":
    main()
