#!/usr/bin/env python3
"""Run bounded, stack-aware quality checks as independent verifier evidence."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path


WORKSPACE = Path("/app")
META_PATH = Path("/tests/task-meta.json")
OUT = Path("/logs/verifier/quality-checks.json")
COMMAND_TIMEOUT_SEC = 240


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def select_checks() -> tuple[list[tuple[list[str], str, str]], dict]:
    package = load_json(WORKSPACE / "package.json")
    scripts = package.get("scripts") if isinstance(package.get("scripts"), dict) else {}
    checks: list[tuple[list[str], str, str]] = []
    if scripts.get("build"):
        checks.append((["npm", "run", "build"], "package.json#scripts.build", "required_build"))
    elif scripts.get("typecheck"):
        checks.append((["npm", "run", "typecheck"], "package.json#scripts.typecheck", "required_typecheck"))
    if scripts.get("test"):
        # Agent-authored tests are never positive product proof, but a failing
        # declared suite is useful counterevidence and must not be hidden by a
        # syntax-only build.
        checks.append((["npm", "test"], "package.json#scripts.test", "supplemental_declared_test"))
    if not checks and ((WORKSPACE / "pyproject.toml").exists() or (WORKSPACE / "setup.py").exists()):
        checks.append((["python3", "-m", "compileall", "-q", "."], "python_compileall", "required_compile"))
    if not checks and (WORKSPACE / "go.mod").exists():
        checks.append((["go", "test", "./..."], "go_test_compile", "required_compile_and_test"))
    if not checks and (WORKSPACE / "Cargo.toml").exists():
        checks.append((["cargo", "check", "--quiet"], "cargo_check", "required_compile"))
    return checks, scripts


def main() -> int:
    task_meta = load_json(META_PATH)
    checks, scripts = select_checks()
    required = task_meta.get("category") == "greenfield"
    result = {
        "schema": "lamina-bench-quality/v2",
        "required": required,
        "status": "missing" if required else "not_applicable",
        "source": checks[0][1] if checks else None,
        "command": checks[0][0] if checks else None,
        "declared_scripts": sorted(scripts),
        "exit_code": None,
        "output_tail": "",
        "checks": [],
    }
    if checks:
        failed = False
        outputs: list[str] = []
        for command, source, role in checks:
            entry = {
                "role": role,
                "source": source,
                "command": command,
                "status": "failed",
                "exit_code": None,
                "output_tail": "",
            }
            try:
                proc = subprocess.run(
                    command,
                    cwd=WORKSPACE,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=COMMAND_TIMEOUT_SEC,
                    check=False,
                )
                entry["exit_code"] = proc.returncode
                entry["status"] = "passed" if proc.returncode == 0 else "failed"
                entry["output_tail"] = (proc.stdout or "")[-8_000:]
            except (OSError, subprocess.TimeoutExpired) as exc:
                entry["output_tail"] = str(exc)[-8_000:]
            failed = failed or entry["status"] != "passed"
            outputs.append(f"[{role}] {source}\n{entry['output_tail']}")
            result["checks"].append(entry)
        has_required_check = any(role.startswith("required_") for _, _, role in checks)
        result["status"] = "failed" if failed else "passed" if has_required_check else (
            "missing" if required else "not_applicable"
        )
        result["exit_code"] = next(
            (entry["exit_code"] for entry in result["checks"] if entry["status"] != "passed"),
            0,
        )
        result["output_tail"] = "\n\n".join(outputs)[-16_000:]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    sources = ", ".join(source for _, source, _ in checks) or "no check discovered"
    print(f"Independent quality check: {result['status']} ({sources})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
