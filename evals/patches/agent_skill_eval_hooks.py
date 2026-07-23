"""Lifecycle hook commands for eval runs.

Three hook points, all plain shell commands so eval suites can keep
provider- or skill-specific logic (GitLab setup, custom graders, teardown)
outside the harness:

- pre-run: once before any agent case starts. Non-zero exit aborts the
  suite before a single model call.
- post-grade: once per run, after ``grading.json`` is written and before
  the workspace is removed. Can append extra assertion results to the
  run's grading (see ``apply_post_grade_hooks``).
- post-run: once after the suite finishes (teardown). Failures are
  recorded but do not fail the run — results already exist.

Every hook receives run metadata through ``ASE_*`` environment variables
on top of the parent environment.
"""

from __future__ import annotations

import json
import os
import subprocess
from typing import Optional

from agent_skill_eval.graders import summarize_assertion_results
from agent_skill_eval.models import AssertionResult, GradingResult

DEFAULT_HOOK_TIMEOUT_SECONDS = 600


class HookError(Exception):
    """A suite-level hook failed in a way that must abort the run."""


def _hook_timeout() -> int:
    return int(os.environ.get("ASE_HOOK_TIMEOUT", DEFAULT_HOOK_TIMEOUT_SECONDS))


def run_hook_command(command: str, env_extra: dict[str, str]) -> dict:
    """Run one hook command through the shell and capture its outcome.

    Returns a JSON-serializable record: command, exit_code, stdout, stderr,
    timed_out. Never raises; callers decide what a failure means.
    """
    env = dict(os.environ)
    env.update({k: v for k, v in env_extra.items() if v is not None})
    timeout = _hook_timeout()
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
        )
        return {
            "command": command,
            "exit_code": result.returncode,
            "stdout": result.stdout or "",
            "stderr": result.stderr or "",
            "timed_out": False,
        }
    except subprocess.TimeoutExpired as e:
        stdout = (e.stdout or b"").decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        stderr = (e.stderr or b"").decode("utf-8", "replace") if isinstance(e.stderr, bytes) else (e.stderr or "")
        return {
            "command": command,
            "exit_code": None,
            "stdout": stdout,
            "stderr": stderr + f"\n[agent-skill-eval] hook timed out after {timeout}s",
            "timed_out": True,
        }


def run_suite_hooks(
    commands: list[str],
    env_extra: dict[str, str],
    label: str,
    fail_fast: bool = True,
) -> list[dict]:
    """Run suite-level hooks (pre-run / post-run) in order.

    With ``fail_fast`` a failing hook raises HookError immediately (pre-run:
    abort before model calls). Without it, all hooks run and failures are
    only recorded (post-run teardown).
    """
    records: list[dict] = []
    for command in commands:
        record = run_hook_command(command, env_extra)
        records.append(record)
        if record["exit_code"] != 0 and fail_fast:
            detail = (record["stderr"] or record["stdout"] or "").strip()
            raise HookError(
                f"{label} hook failed (exit {record['exit_code']}): {command}" + (f"\n{detail}" if detail else "")
            )
    return records


def _parse_hook_assertions(stdout: str) -> Optional[list[AssertionResult]]:
    """Parse a post-grade hook's stdout as a list of assertion results.

    Expected shape: a JSON array of {"text": ..., "passed": bool,
    "evidence": ...} objects. Returns None when stdout is not that shape —
    hooks are free to print anything; only valid JSON results are merged.
    """
    try:
        data = json.loads(stdout)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, list):
        return None

    results: list[AssertionResult] = []
    for item in data:
        if not isinstance(item, dict) or "text" not in item or "passed" not in item:
            return None
        results.append(
            AssertionResult(
                text=str(item["text"]),
                passed=bool(item["passed"]),
                evidence=str(item.get("evidence", "")),
                method="hook",
            )
        )
    return results


def apply_post_grade_hooks(
    commands: list[str],
    env_extra: dict[str, str],
    grading: GradingResult,
) -> tuple[GradingResult, list[dict]]:
    """Run post-grade hooks and merge their checks into the grading result.

    Contract: a hook that prints a JSON array of
    ``{"text", "passed", "evidence"}`` objects gets those appended as
    ``method="hook"`` assertion results. A hook that exits non-zero adds one
    failed result so external grading failures show up in the same
    ``grading.json`` that ``report`` reads. The summary is recomputed.
    """
    records: list[dict] = []
    extra_results: list[AssertionResult] = []

    for command in commands:
        record = run_hook_command(command, env_extra)
        records.append(record)

        parsed = _parse_hook_assertions(record["stdout"])
        if parsed:
            extra_results.extend(parsed)

        if record["exit_code"] != 0:
            detail = (record["stderr"] or record["stdout"] or "").strip()
            extra_results.append(
                AssertionResult(
                    text=f"post-grade hook succeeded: {command}",
                    passed=False,
                    evidence=(
                        f"hook exited {record['exit_code']}"
                        + (" (timed out)" if record["timed_out"] else "")
                        + (f": {detail[:500]}" if detail else "")
                    ),
                    method="hook",
                )
            )

    if not extra_results:
        return grading, records

    # Prefer post-grade hook results over LLM rubric for the same assertion
    # text. Structural hooks (grade-lamina.mjs) are authoritative; appending
    # both caused false fails when the LLM misread file-backed checks
    # (e.g. handoff maps checklist ids / proofs[] present).
    by_text: dict[str, AssertionResult] = {}
    order: list[str] = []
    for result in list(grading.assertion_results) + extra_results:
        key = result.text
        if key not in by_text:
            order.append(key)
        # Later hook results win over earlier LLM results for the same text.
        if key not in by_text or result.method == "hook":
            by_text[key] = result
    all_results = [by_text[key] for key in order]
    return (
        GradingResult(
            assertion_results=all_results,
            summary=summarize_assertion_results(all_results),
        ),
        records,
    )
