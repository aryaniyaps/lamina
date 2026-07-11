"""Golden checklist coverage against bundled implementation artifact."""
from __future__ import annotations

import sys
from pathlib import Path

import rewardkit as rk
from rewardkit import criterion

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from criteria import ARTIFACT_OUT, GOLDEN_PATH, read_yaml, score_golden  # noqa: E402


@criterion(shared=True)
def golden_checklist_coverage(workspace: Path) -> float:
    if not ARTIFACT_OUT.exists():
        return 0.0
    if not GOLDEN_PATH.exists():
        return 0.0
    golden = read_yaml(GOLDEN_PATH)
    artifact = ARTIFACT_OUT.read_text(encoding="utf-8", errors="replace")
    result = score_golden(golden, artifact)
    meta_path = Path("/logs/verifier/verifier-meta.json")
    if meta_path.exists():
        import json

        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["golden_coverage_pct"] = result["coverage_score"]
        meta["golden_checks_passed"] = result["passed"]
        meta["golden_checks_total"] = result["total"]
        meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return result["coverage_norm"]


rk.golden_checklist_coverage(weight=1.0)
