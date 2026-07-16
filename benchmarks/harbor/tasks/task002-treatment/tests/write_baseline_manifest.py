#!/usr/bin/env python3
"""Write a hidden pre-agent application-source manifest for fair delta capture."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from criteria import build_artifact_manifest  # noqa: E402


if len(sys.argv) != 3:
    raise SystemExit("usage: write_baseline_manifest.py WORKSPACE OUTPUT")

workspace = Path(sys.argv[1])
output = Path(sys.argv[2])
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(
    json.dumps(build_artifact_manifest(workspace), indent=2) + "\n",
    encoding="utf-8",
)
