# /// script
# dependencies = []
# ///
"""LaminaBench paired aggregation for Harbor dataset metric.py.

Reads enriched reward.json objects (one per trial line) with lamina_task_id,
lamina_arm, and lamina_run. Medians within each (task, arm) cell, then computes
paired treatment − control deltas with bootstrap 95% CI over tasks.
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any


def parse_reward_line(line: str) -> dict[str, Any] | None:
    line = line.strip()
    if not line:
        return None
    data = json.loads(line)
    if data is None:
        return None
    if not isinstance(data, dict):
        raise ValueError(f"Expected reward object per line, got {type(data).__name__}")
    return data


def trial_score(reward: dict[str, Any]) -> float:
    if "reward" in reward:
        return float(reward["reward"] or 0.0)
    if "composite" in reward:
        return float(reward["composite"] or 0.0)
    raise ValueError("Reward object missing 'reward' or 'composite'")


def median(values: list[float]) -> float:
    if not values:
        return 0.0
    return float(statistics.median(values))


def bootstrap_ci(
    deltas: list[float],
    *,
    samples: int = 5000,
    alpha: float = 0.05,
    seed: int = 42,
) -> tuple[float, float]:
    if not deltas:
        return 0.0, 0.0
    if len(deltas) == 1:
        return deltas[0], deltas[0]
    rng = random.Random(seed)
    n = len(deltas)
    means: list[float] = []
    for _ in range(samples):
        draw = [deltas[rng.randrange(n)] for _ in range(n)]
        means.append(sum(draw) / n)
    means.sort()
    lo_idx = max(0, int((alpha / 2) * samples) - 1)
    hi_idx = min(samples - 1, int((1 - alpha / 2) * samples))
    return means[lo_idx], means[hi_idx]


def aggregate_rewards(rewards: list[dict[str, Any]]) -> dict[str, Any]:
    by_cell: dict[tuple[str, str], dict[int, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    categories: dict[str, str] = {}

    for row in rewards:
        task_id = row.get("lamina_task_id")
        arm = row.get("lamina_arm")
        if not task_id or arm not in ("control", "treatment"):
            continue
        run = int(row.get("lamina_run") or 1)
        by_cell[(task_id, arm)][run].append(trial_score(row))
        if row.get("lamina_category"):
            categories[task_id] = row["lamina_category"]

    task_ids = sorted({task for task, _ in by_cell})
    cells: dict[str, Any] = {}
    paired_deltas: list[float] = []
    paired_by_task: dict[str, float] = {}
    wins = 0

    for task_id in task_ids:
        control_runs = by_cell.get((task_id, "control"), {})
        treatment_runs = by_cell.get((task_id, "treatment"), {})
        control_scores = [median(v) for v in control_runs.values() if v]
        treatment_scores = [median(v) for v in treatment_runs.values() if v]
        control_median = median(control_scores)
        treatment_median = median(treatment_scores)
        delta = treatment_median - control_median
        if control_scores and treatment_scores:
            paired_deltas.append(delta)
            paired_by_task[task_id] = round(delta, 4)
            if delta > 0:
                wins += 1
        cells[task_id] = {
            "category": categories.get(task_id),
            "control": {
                "runs_observed": len(control_scores),
                "run_medians": [round(x, 4) for x in control_scores],
                "cell_median": round(control_median, 4),
            },
            "treatment": {
                "runs_observed": len(treatment_scores),
                "run_medians": [round(x, 4) for x in treatment_scores],
                "cell_median": round(treatment_median, 4),
            },
            "delta_treatment_minus_control": round(delta, 4),
        }

    mean_delta = sum(paired_deltas) / len(paired_deltas) if paired_deltas else 0.0
    ci_lo, ci_hi = bootstrap_ci(paired_deltas)

    runs_per_arm = max(
        (
            max(len(runs) for runs in arms.values()) if arms else 0
            for arms in (
                {arm: by_cell.get((task_id, arm), {}) for arm in ("control", "treatment")}
                for task_id in task_ids
            )
        ),
        default=0,
    )

    return {
        "methodology": "design_b_skillsbench_paired",
        "inference_unit": "task",
        "cell_aggregation": "median_across_runs",
        "tasks_paired": len(paired_deltas),
        "tasks_total": len(task_ids),
        "runs_per_arm_observed_max": runs_per_arm,
        "control_mean_reward": round(
            statistics.mean(cells[t]["control"]["cell_median"] for t in paired_by_task), 4
        )
        if paired_by_task
        else None,
        "treatment_mean_reward": round(
            statistics.mean(cells[t]["treatment"]["cell_median"] for t in paired_by_task), 4
        )
        if paired_by_task
        else None,
        "mean_delta_treatment_minus_control": round(mean_delta, 4),
        "mean_delta_pp": round(mean_delta * 100, 2),
        "bootstrap_95_ci_delta": [round(ci_lo, 4), round(ci_hi, 4)],
        "bootstrap_95_ci_delta_pp": [round(ci_lo * 100, 2), round(ci_hi * 100, 2)],
        "treatment_win_rate": round(wins / len(paired_deltas), 4) if paired_deltas else None,
        "paired_by_task": paired_by_task,
        "cells": cells,
    }


def main(input_path: Path, output_path: Path) -> None:
    rows: list[dict[str, Any]] = []
    for line in input_path.read_text(encoding="utf-8").splitlines():
        parsed = parse_reward_line(line)
        if parsed is not None:
            rows.append(parsed)

    result = aggregate_rewards(rows)
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LaminaBench paired benchmark metrics")
    parser.add_argument(
        "-i",
        "--input-path",
        type=Path,
        required=True,
        help="JSONL of enriched reward objects (one per trial).",
    )
    parser.add_argument(
        "-o",
        "--output-path",
        type=Path,
        required=True,
        help="Output JSON path for aggregated paired metrics.",
    )
    args = parser.parse_args()
    main(args.input_path, args.output_path)
