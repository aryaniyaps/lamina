#!/usr/bin/env python3
"""Apply LaminaBench gates and enrich calibrated behavior rewards."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from criteria import (  # noqa: E402
    CRITERIA_KEYS,
    META_PATH,
    REWARD_DETAILS_PATH,
    REWARD_PATH,
    VERIFIER_META_PATH,
    likert_norm_to_mean,
)

PASS_THRESHOLD = 0.5


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def extract_llm_scores(details: dict) -> dict[str, float]:
    scores: dict[str, float] = {}
    llm = details.get("llm_judge") or details.get("rewards", {}).get("llm_judge") or {}
    criteria = llm.get("criteria") or llm.get("children") or []
    if isinstance(criteria, dict):
        criteria = list(criteria.values())
    for entry in criteria:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name") or entry.get("id") or entry.get("description")
        if not name:
            continue
        raw = entry.get("raw_value")
        value = entry.get("value")
        if raw is not None and isinstance(raw, (int, float)):
            scores[str(name)] = float(raw)
        elif value is not None and isinstance(value, (int, float)):
            scores[str(name)] = likert_norm_to_mean(float(value))
    return scores


def resolve_composite(rewards: dict) -> float:
    """The subscription judge already combines dimensions and item coverage."""
    return float(rewards.get("llm_judge", 0.0) or 0.0)


def build_fallback_rewards(_meta: dict) -> dict:
    """Mark scoring incomplete when LLM judge is unavailable — not a claimable score."""
    return {
        "llm_judge": 0.0,
        "composite": 0.0,
        "llm_judge_degraded": True,
        "scoring_incomplete": True,
        "llm_judge_error": "unavailable_after_retries",
    }


def main() -> int:
    rewards = load_json(REWARD_PATH)
    details = load_json(REWARD_DETAILS_PATH)
    meta = load_json(VERIFIER_META_PATH)
    task_meta = load_json(META_PATH)

    if not rewards and meta.get("artifact_valid") is not None:
        rewards = build_fallback_rewards(meta)

    if rewards.get("llm_judge_degraded"):
        rewards["scoring_incomplete"] = True
        rewards["composite"] = 0.0

    composite = resolve_composite(rewards)
    artifact_valid = bool(meta.get("artifact_valid"))
    clarify_stall = bool(meta.get("clarify_stall"))
    scoring_incomplete = bool(rewards.get("scoring_incomplete") or rewards.get("llm_judge_degraded"))

    if clarify_stall or not artifact_valid or scoring_incomplete:
        final_reward = 0.0
    else:
        final_reward = composite

    llm_scores = extract_llm_scores(details)
    if llm_scores:
        llm_mean = round(sum(llm_scores.values()) / len(llm_scores), 2)
    else:
        llm_norm = float(rewards.get("llm_judge", 0.0) or 0.0)
        llm_mean = likert_norm_to_mean(llm_norm) if llm_norm else None

    run_attempt = int(os.environ.get("LAMINA_BENCH_RUN", "1") or "1")

    feedback = (
        f"Calibrated behavior {composite:.3f}; dimension mean {llm_mean:.2f}/5"
        if artifact_valid and llm_mean is not None and not scoring_incomplete
        else "LLM judge unavailable (scoring incomplete; excluded from claim)"
        if artifact_valid and scoring_incomplete
        else "Clarify stall — incomplete deliverables"
        if clarify_stall
        else "Missing or invalid implementation artifact"
    )

    enriched = {
        **rewards,
        "reward": round(final_reward, 4),
        "max_reward": 1,
        "composite": round(0.0 if scoring_incomplete else composite, 4),
        "llm_judge_mean": llm_mean,
        "judge_mode": "codex_subscription_calibrated_behavior_v3",
        "claim_surface": "strict_dimensions_plus_item_coverage",
        "artifact_valid": artifact_valid,
        "clarify_stall": clarify_stall,
        "scoring_incomplete": scoring_incomplete,
        "llm_judge_degraded": bool(rewards.get("llm_judge_degraded")),
        "feedback": feedback,
        "llm_scores": {key: llm_scores.get(key) for key in CRITERIA_KEYS if key in llm_scores},
        "lamina_task_id": task_meta.get("task_id"),
        "lamina_arm": task_meta.get("arm"),
        "lamina_category": task_meta.get("category"),
        "lamina_run": run_attempt,
        "harness_version": task_meta.get("harness_version"),
        "results_contract_version": task_meta.get("results_contract_version"),
    }
    # Drop legacy phrase-golden fields from claim payload if present.
    for legacy in ("golden_coverage", "checks_passed", "checks_total", "golden_role"):
        enriched.pop(legacy, None)

    REWARD_PATH.parent.mkdir(parents=True, exist_ok=True)
    REWARD_PATH.write_text(json.dumps(enriched, indent=2) + "\n", encoding="utf-8")
    (REWARD_PATH.parent / "reward.txt").write_text(f"{enriched['reward']}\n", encoding="utf-8")

    if not artifact_valid or clarify_stall or scoring_incomplete:
        return 1
    if final_reward < PASS_THRESHOLD:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
