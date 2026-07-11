#!/usr/bin/env python3
"""Bundle /app source into /logs/verifier/implementation.md before Rewardkit scoring."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from criteria import (  # noqa: E402
    ARTIFACT_OUT,
    VERIFIER_META_PATH,
    capture_implementation_artifact,
    is_artifact_valid,
    read_agent_output,
)

ARTIFACT_OUT.parent.mkdir(parents=True, exist_ok=True)
VERIFIER_META_PATH.parent.mkdir(parents=True, exist_ok=True)

workspace = Path("/app")
agent_output = read_agent_output()
artifact = capture_implementation_artifact(workspace, agent_output)
artifact_valid = is_artifact_valid(artifact)

ARTIFACT_OUT.write_text(artifact, encoding="utf-8")

meta = {
    "artifact_valid": artifact_valid,
    "artifact_chars": len(artifact),
}
if VERIFIER_META_PATH.exists():
    meta.update(json.loads(VERIFIER_META_PATH.read_text(encoding="utf-8")))
meta["artifact_valid"] = artifact_valid
VERIFIER_META_PATH.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

print(f"Captured implementation artifact ({len(artifact)} chars, valid={artifact_valid})")
