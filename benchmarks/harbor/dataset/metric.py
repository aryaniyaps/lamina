"""Harbor dataset metric for arm-aware development reports."""
from __future__ import annotations

from collections import defaultdict


def aggregate(records):
    grouped = defaultdict(list)
    for record in records:
        name = record.get("task_name", "")
        arm = next((candidate for candidate in ("raw", "plan", "lamina") if name.endswith(f"-{candidate}")), "unknown")
        task = name.rsplit("-", 1)[0]
        reward = record.get("verifier_result", {}).get("reward", record.get("reward", 0))
        if isinstance(reward, dict):
            reward = reward.get("reward", reward.get("composite", 0))
        try:
            grouped[(task, arm)].append(float(reward))
        except (TypeError, ValueError):
            grouped[(task, arm)].append(0.0)
    cells = {f"{task}__{arm}": sum(values) / len(values) for (task, arm), values in grouped.items()}
    return {"schema": "lamina-harbor-metric/v1", "cells": cells, "record_count": len(records)}
