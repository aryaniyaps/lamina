#!/usr/bin/env python3
"""agent-skill-eval entrypoint with full Lamina skill tree per workspace."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INSTALL_ALL = ROOT / "evals/hooks/install-all-skills.sh"
EXPECTED_PUBLIC_SKILLS = 59


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
    from agent_skill_eval.skills import SKILL_PATHS

    for relative_dir in SKILL_PATHS[agent_type]:
        skills_dir = workspace / relative_dir
        installed = sorted(
            child.name
            for child in skills_dir.iterdir()
            if child.is_dir() and (child / "SKILL.md").is_file()
        )
        if len(installed) != EXPECTED_PUBLIC_SKILLS or "lamina" not in installed:
            raise RuntimeError(
                f"expected all {EXPECTED_PUBLIC_SKILLS} public Lamina skills in "
                f"{skills_dir}; found {len(installed)}"
            )


def _patch_skill_installer() -> None:
    from agent_skill_eval.skills import SkillInstaller

    original_install = SkillInstaller.install

    def install_with_full_tree(self, workspace: Path, agent_type):
        installed_to = original_install(self, workspace, agent_type)
        _install_all_skills(workspace, agent_type)
        return installed_to

    SkillInstaller.install = install_with_full_tree  # type: ignore[method-assign]

    # graphd is deliberately a persistent, single-owner process. Codex's
    # workspace-write sandbox gives separate tool invocations isolated Unix
    # socket and PID namespaces, which makes a healthy daemon look dead and
    # turns the next command into a false split-brain attempt. Eval workspaces
    # are disposable and independently checked for out-of-scope writes, so run
    # Codex without that namespace isolation for behavioral graph evals.
    from agent_skill_eval.harnesses import CodexHarness

    original_build_command = CodexHarness.build_command

    def build_command_with_persistent_graphd(self, prompt: str, output_dir: Path):
        command = original_build_command(self, prompt, output_dir)
        sandbox_index = command.index("--sandbox") + 1
        command[sandbox_index] = "danger-full-access"
        return command

    CodexHarness.build_command = build_command_with_persistent_graphd  # type: ignore[method-assign]


def main() -> None:
    _patch_skill_installer()
    from agent_skill_eval.cli import app

    app()


if __name__ == "__main__":
    main()
