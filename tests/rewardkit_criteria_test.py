#!/usr/bin/env python3
"""Unit tests for LaminaBench Rewardkit criteria helpers."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

VERIFIER = Path(__file__).resolve().parents[1] / "benchmarks/harbor/verifier"
sys.path.insert(0, str(VERIFIER))

from criteria import (  # noqa: E402
    capture_implementation_artifact,
    is_artifact_valid,
    is_clarify_output,
    score_golden,
)


class CriteriaTests(unittest.TestCase):
    def test_golden_phrase_matching(self) -> None:
        golden = {
            "required_invariants": ["one_active_budget_per_household"],
            "required_entities": ["budget"],
        }
        artifact = "function enforceSingleActiveBudget() { /* one budget per household */ }"
        result = score_golden(golden, artifact)
        self.assertGreater(result["coverage_score"], 0)
        self.assertGreater(result["coverage_norm"], 0.0)

    def test_artifact_capture_and_validity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "src"
            src.mkdir()
            (src / "app.ts").write_text("export const ok = true;\n", encoding="utf-8")
            artifact = capture_implementation_artifact(root)
            self.assertTrue(is_artifact_valid(artifact))
            self.assertIn("src/app.ts", artifact)

    def test_clarify_detection(self) -> None:
        output = "## Lamina: Clarification needed\n### Clarifying questions\nPlease answer"
        self.assertTrue(is_clarify_output(output))
        self.assertFalse(is_clarify_output("Implemented feature successfully"))


if __name__ == "__main__":
    unittest.main()
