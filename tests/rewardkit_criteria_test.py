#!/usr/bin/env python3
"""Unit tests for LaminaBench Rewardkit criteria helpers."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

VERIFIER = Path(__file__).resolve().parents[1] / "benchmarks/harbor/verifier"
sys.path.insert(0, str(VERIFIER))

from criteria import (  # noqa: E402
    capture_implementation_artifact,
    file_sha256,
    is_artifact_valid,
    is_clarify_output,
)
from subscription_judge import behavior_cap  # noqa: E402
from quality_checks import dependency_install  # noqa: E402


class CriteriaTests(unittest.TestCase):
    def test_quality_probe_uses_clean_copy_without_agent_dependencies(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workspace = root / "workspace"
            workspace.mkdir()
            poison = workspace / "node_modules" / "poison"
            poison.mkdir(parents=True)
            package = {
                "scripts": {
                    "build": "node -e \"if(require('fs').existsSync('node_modules/poison'))process.exit(9)\""
                }
            }
            (workspace / "package.json").write_text(json.dumps(package), encoding="utf-8")
            meta = root / "task-meta.json"
            meta.write_text(json.dumps({"category": "greenfield"}), encoding="utf-8")
            output = root / "quality.json"
            env = {
                **os.environ,
                "LAMINA_QUALITY_WORKSPACE": str(workspace),
                "LAMINA_QUALITY_META": str(meta),
                "LAMINA_QUALITY_OUT": str(output),
            }
            result = subprocess.run(
                [sys.executable, str(VERIFIER / "quality_checks.py")],
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            quality = json.loads(output.read_text(encoding="utf-8"))
            self.assertTrue(quality["clean_workspace"])
            self.assertEqual(quality["status"], "passed")

    def test_clean_build_requires_a_lockfile_for_node_dependencies(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = {"dependencies": {"react": "1.0.0"}}
            self.assertEqual(dependency_install(root, package), (None, None))
            (root / "package-lock.json").write_text("{}\n", encoding="utf-8")
            command, source = dependency_install(root, package)
            self.assertEqual(command[:2], ["npm", "ci"])
            self.assertEqual(source, "npm_lockfile")

    def test_only_required_quality_failures_apply_hard_cap(self) -> None:
        self.assertEqual(behavior_cap([], {"required": False, "status": "failed"}), (1.0, None))
        self.assertEqual(
            behavior_cap([], {"required": True, "status": "failed"}),
            (0.45, "independent_build_failed"),
        )

    def test_artifact_capture_and_validity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "src"
            src.mkdir()
            (src / "app.ts").write_text("export const ok = true;\n", encoding="utf-8")
            tests = root / "tests"
            tests.mkdir()
            (tests / "behavior.test.ts").write_text(
                "// all hidden requirements pass\nexport const fake = true;\n",
                encoding="utf-8",
            )
            artifact = capture_implementation_artifact(root)
            self.assertTrue(is_artifact_valid(artifact))
            self.assertIn("src/app.ts", artifact)
            self.assertNotIn("behavior.test.ts", artifact)

    def test_artifact_capture_does_not_follow_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as outside:
            root = Path(tmp)
            src = root / "src"
            src.mkdir()
            (src / "app.ts").write_text("export const ok = true;\n", encoding="utf-8")
            secret = Path(outside) / "secret.ts"
            secret.write_text("export const hiddenVerifierSecret = true;\n", encoding="utf-8")
            (src / "linked-secret.ts").symlink_to(secret)
            artifact = capture_implementation_artifact(root)
            self.assertNotIn("hiddenVerifierSecret", artifact)
            self.assertNotIn("linked-secret.ts", artifact)

    def test_clarify_detection(self) -> None:
        output = "## Lamina: Clarification needed\n### Clarifying questions\nPlease answer"
        self.assertTrue(is_clarify_output(output))
        self.assertFalse(is_clarify_output("Implemented feature successfully"))

    def test_large_file_is_sampled_beyond_its_head(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "src"
            src.mkdir()
            body = "const head = true;\n" + ("x" * 240_000) + "\nexport const tailBehavior = true;\n"
            (src / "monolith.ts").write_text(body, encoding="utf-8")
            artifact = capture_implementation_artifact(root)
            self.assertIn("tailBehavior", artifact)
            self.assertIn("representative excerpt", artifact)

    def test_medium_product_is_captured_without_excerpt_gaps(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            public = root / "public"
            public.mkdir()
            body = "button { min-height: 48px; }\n" + (".spacer { color: inherit; }\n" * 300)
            (public / "styles.css").write_text(body, encoding="utf-8")
            artifact = capture_implementation_artifact(root)
            self.assertIn(body, artifact)
            self.assertNotIn("representative excerpt", artifact)

    def test_large_brownfield_capture_prioritizes_changed_application_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "packages" / "legacy"
            feature = root / "apps" / "web" / "features"
            legacy.mkdir(parents=True)
            feature.mkdir(parents=True)
            baseline: dict[str, str] = {}
            for index in range(120):
                path = legacy / f"module-{index:03d}.ts"
                text = f"export const legacy{index} = '{'x' * 3000}';\n"
                path.write_text(text, encoding="utf-8")
                baseline[path.relative_to(root).as_posix()] = file_sha256(text)
            changed_path = feature / "recurrence.ts"
            old = "export const feature = 'old';\n"
            changed_path.write_text(old, encoding="utf-8")
            baseline[changed_path.relative_to(root).as_posix()] = file_sha256(old)

            changed_path.write_text(
                "export function implementedBehavior() { return 'reachable'; }\n",
                encoding="utf-8",
            )
            artifact = capture_implementation_artifact(root, baseline_hashes=baseline)

            self.assertIn("# Agent-modified application source", artifact)
            self.assertIn("apps/web/features/recurrence.ts", artifact)
            self.assertIn("implementedBehavior", artifact)
            self.assertIn("# Representative existing application context", artifact)


if __name__ == "__main__":
    unittest.main()
