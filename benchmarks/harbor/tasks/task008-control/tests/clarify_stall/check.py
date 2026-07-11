"""Detect unattended clarify stalls (secondary gate)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import rewardkit as rk
from rewardkit import criterion

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from criteria import (  # noqa: E402
    ARTIFACT_OUT,
    VERIFIER_META_PATH,
    is_artifact_valid,
    is_clarify_output,
    read_agent_output,
)


@criterion(shared=True)
def no_clarify_stall(workspace: Path) -> float:
    agent_output = read_agent_output()
    artifact = (
        ARTIFACT_OUT.read_text(encoding="utf-8", errors="replace")
        if ARTIFACT_OUT.exists()
        else ""
    )
    artifact_valid = is_artifact_valid(artifact)
    clarify_stall = not artifact_valid and is_clarify_output(agent_output)

    meta = {}
    if VERIFIER_META_PATH.exists():
        meta = json.loads(VERIFIER_META_PATH.read_text(encoding="utf-8"))
    meta["artifact_valid"] = artifact_valid
    meta["clarify_stall"] = clarify_stall
    VERIFIER_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    VERIFIER_META_PATH.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    return 0.0 if clarify_stall else 1.0


rk.no_clarify_stall(weight=1.0)
