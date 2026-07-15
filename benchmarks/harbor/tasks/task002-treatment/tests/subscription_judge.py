#!/usr/bin/env python3
"""Run the Lamina behavior rubric through Codex using ChatGPT subscription auth."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import tomllib
from pathlib import Path

TESTS = Path("/tests")
LOGS = Path("/logs/verifier")
CONFIG = TESTS / "llm_judge/product-behavior.toml"
IMPLEMENTATION = LOGS / "implementation.md"
CONTEXT = TESTS / "judge-context.md"
PROMPT_TEMPLATE = TESTS / "llm_judge/prompt.md"
MODEL = os.environ.get("CODEX_MODEL", "gpt-5.6-sol")


def main() -> int:
    config = tomllib.loads(CONFIG.read_text(encoding="utf-8"))
    criteria = config.get("criterion", [])
    if not IMPLEMENTATION.exists() or not criteria:
        return 1

    rubric = "\n".join(
        f"- {item['name']} (weight {item.get('weight', 1)}): {item['description']}"
        for item in criteria
    )
    prompt = f"""You are the independent LaminaBench product-behavior judge.
Evaluate only evidence present in the implementation artifact. Use the reference as a behavioral rubric, not a phrase-matching checklist. Return every criterion exactly once with an integer raw_value from 1 (absent/broken) to 5 (excellent), plus concise evidence-based reasoning. Do not modify files.

Rubric:
{rubric}

Reference context:
{CONTEXT.read_text(encoding='utf-8')}

Judge guidance:
{PROMPT_TEMPLATE.read_text(encoding='utf-8')}

Implementation artifact:
{IMPLEMENTATION.read_text(encoding='utf-8')}
"""
    schema = {
        "type": "object",
        "properties": {
            "criteria": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "raw_value": {"type": "integer", "minimum": 1, "maximum": 5},
                        "reasoning": {"type": "string"},
                    },
                    "required": ["name", "raw_value", "reasoning"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["criteria"],
        "additionalProperties": False,
    }

    LOGS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        schema_path = Path(tmp) / "schema.json"
        output_path = Path(tmp) / "judge.json"
        schema_path.write_text(json.dumps(schema), encoding="utf-8")
        result = subprocess.run(
            [
                "codex", "exec", "--dangerously-bypass-approvals-and-sandbox",
                "--skip-git-repo-check", "--model", MODEL,
                "-c", "model_reasoning_effort=high", "--output-schema", str(schema_path),
                "--output-last-message", str(output_path), "--", prompt,
            ],
            cwd="/app", stdin=subprocess.DEVNULL, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=int(config.get("judge", {}).get("timeout", 300)),
        )
        (LOGS / "subscription-judge.log").write_text(result.stdout or "", encoding="utf-8")
        if result.returncode != 0 or not output_path.exists():
            return 1
        judged = json.loads(output_path.read_text(encoding="utf-8"))

    expected = {item["name"]: item for item in criteria}
    entries = judged.get("criteria", [])
    by_name = {entry.get("name"): entry for entry in entries if entry.get("name") in expected}
    if set(by_name) != set(expected):
        return 1

    weighted = sum(by_name[name]["raw_value"] * float(item.get("weight", 1)) for name, item in expected.items())
    total_weight = sum(float(item.get("weight", 1)) for item in expected.values())
    mean = weighted / total_weight
    normalized = (mean - 1.0) / 4.0

    details_entries = [
        {"name": name, "raw_value": by_name[name]["raw_value"], "reasoning": by_name[name]["reasoning"]}
        for name in expected
    ]
    (LOGS / "reward-details.json").write_text(
        json.dumps({"llm_judge": {"criteria": details_entries}}, indent=2) + "\n",
        encoding="utf-8",
    )
    (LOGS / "reward.json").write_text(
        json.dumps({"llm_judge": round(normalized, 6), "composite": round(normalized, 6)}, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
