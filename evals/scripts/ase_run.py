#!/usr/bin/env python3
"""agent-skill-eval entrypoint with full Lamina skill tree per workspace."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INSTALL_ALL = ROOT / "evals/hooks/install-all-skills.sh"


def _install_all_skills(workspace: Path, agent_type) -> None:
    env = {
        **os.environ,
        "ASE_WORKSPACE_PATH": str(workspace),
        "ASE_AGENT": agent_type.value,
    }
    subprocess.run(
        ["bash", str(INSTALL_ALL)],
        cwd=ROOT,
        env=env,
        check=True,
    )


def _patch_skill_installer() -> None:
    from agent_skill_eval.skills import SkillInstaller

    original_install = SkillInstaller.install

    def install_with_full_tree(self, workspace: Path, agent_type):
        installed_to = original_install(self, workspace, agent_type)
        _install_all_skills(workspace, agent_type)
        return installed_to

    SkillInstaller.install = install_with_full_tree  # type: ignore[method-assign]


def main() -> None:
    _patch_skill_installer()
    from agent_skill_eval.cli import app

    app()


if __name__ == "__main__":
    main()
