#!/usr/bin/env python3
"""Bundle /app source into /logs/verifier/implementation.md before Rewardkit scoring."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from criteria import (  # noqa: E402
    ARTIFACT_MANIFEST_OUT,
    ARTIFACT_OUT,
    VERIFIER_META_PATH,
    capture_implementation_artifact,
    is_artifact_valid,
    is_clarify_output,
    read_agent_output,
)

ARTIFACT_OUT.parent.mkdir(parents=True, exist_ok=True)
VERIFIER_META_PATH.parent.mkdir(parents=True, exist_ok=True)

workspace = Path("/app")
agent_output = read_agent_output()
artifact = capture_implementation_artifact(workspace, agent_output)
artifact_valid = is_artifact_valid(artifact)
clarify_stall = not artifact_valid and is_clarify_output(agent_output)

ARTIFACT_OUT.write_text(artifact, encoding="utf-8")

meta = {
    "artifact_valid": artifact_valid,
    "clarify_stall": clarify_stall,
    "artifact_chars": len(artifact),
}
if VERIFIER_META_PATH.exists():
    meta.update(json.loads(VERIFIER_META_PATH.read_text(encoding="utf-8")))
meta["artifact_valid"] = artifact_valid
if ARTIFACT_MANIFEST_OUT.exists():
    try:
        manifest = json.loads(ARTIFACT_MANIFEST_OUT.read_text(encoding="utf-8"))
        meta["artifact_tree_sha256"] = manifest.get("tree_sha256")
        meta["artifact_file_count"] = manifest.get("file_count")
    except (OSError, json.JSONDecodeError):
        pass
VERIFIER_META_PATH.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

print(f"Captured implementation artifact ({len(artifact)} chars, valid={artifact_valid})")
