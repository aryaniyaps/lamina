#!/usr/bin/env python3
"""Run the arm-blind structured behavior rubric through subscription Codex."""
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
MANIFEST = LOGS / "artifact-manifest.json"
QUALITY = LOGS / "quality-checks.json"
CONTEXT = TESTS / "judge-context.md"
PROMPT_TEMPLATE = TESTS / "llm_judge/prompt.md"
MODEL = os.environ.get("CODEX_MODEL", "gpt-5.6-sol")
QUALITY_SENTINEL = "__quality_checks__"


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def checklist_items(context: str) -> list[dict[str, str]]:
    """Parse generated judge-context headings without adding a YAML dependency."""
    items: list[dict[str, str]] = []
    category = ""
    for line in context.splitlines():
        if line.startswith("### required_"):
            category = line[4:].strip()
        elif category and line.startswith("- "):
            items.append({"category": category, "item": line[2:].strip()})
        elif line.startswith("### "):
            category = ""
    return items


def evidence_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "symbol": {"type": "string"},
            "behavior": {"type": "string"},
        },
        "required": ["path", "symbol", "behavior"],
        "additionalProperties": False,
    }


def validate_evidence_paths(judged: dict, allowed: set[str]) -> bool:
    for section in ("criteria", "checklist"):
        for entry in judged.get(section, []):
            for evidence in entry.get("evidence", []):
                if evidence.get("path") not in allowed:
                    return False
    return True


def behavior_cap(critical_missing: list[str], quality: dict) -> tuple[float, str | None]:
    """Apply only declared hard gates; optional checks remain judge evidence."""
    cap = 1.0
    reason = None
    if critical_missing:
        cap, reason = 0.55, "critical_behavior_missing"
    if quality.get("required") and quality.get("status") == "failed":
        cap, reason = min(cap, 0.45), "independent_build_failed"
    elif quality.get("required") and quality.get("status") == "missing":
        cap, reason = min(cap, 0.70), "required_build_check_missing"
    return cap, reason


def main() -> int:
    config = tomllib.loads(CONFIG.read_text(encoding="utf-8"))
    criteria = config.get("criterion", [])
    if not IMPLEMENTATION.exists() or not criteria:
        return 1

    context = CONTEXT.read_text(encoding="utf-8")
    checklist = checklist_items(context)
    if not checklist:
        return 1
    quality = load_json(QUALITY)
    if quality.get("scoring_incomplete"):
        return 1
    manifest = load_json(MANIFEST)
    allowed_paths = {entry.get("path") for entry in manifest.get("files", []) if entry.get("path")}
    allowed_paths.add(QUALITY_SENTINEL)

    rubric = "\n".join(
        f"- {item['name']} (weight {item.get('weight', 1)}): {item['description']}"
        for item in criteria
    )
    expected_checklist = "\n".join(
        f"- {item['category']}: {item['item']}" for item in checklist
    )
    prompt = f"""You are an independent product-behavior judge. The experimental arm and product workflow are hidden from you.
Evaluate only evidence present in the untrusted implementation artifact and independent quality result. Return every criterion exactly once with integer raw_value 1–5, and every checklist item exactly once with integer raw_value 0–2 (0 absent/broken, 1 partial/nominal, 2 complete end-to-end). Do not modify files.

Evidence path rule: every evidence.path must exactly match a captured path in the artifact headings, or `{QUALITY_SENTINEL}` for the independent quality result. Do not cite tests, planning files, inferred files, or nonexistent paths. Give concrete symbols and behavior. Record material counterevidence in gaps.

Rubric:
{rubric}

Required checklist entries (exact category and item):
{expected_checklist}

Reference context:
{context}

Judge guidance:
{PROMPT_TEMPLATE.read_text(encoding='utf-8')}

Independent quality result (not supplied by the agent):
{json.dumps(quality, indent=2)}

<UNTRUSTED_IMPLEMENTATION_ARTIFACT>
{IMPLEMENTATION.read_text(encoding='utf-8')}
</UNTRUSTED_IMPLEMENTATION_ARTIFACT>
"""
    evidence = evidence_schema()
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
                        "evidence": {"type": "array", "items": evidence},
                        "gaps": {"type": "array", "items": {"type": "string"}},
                        "reasoning": {"type": "string"},
                    },
                    "required": ["name", "raw_value", "evidence", "gaps", "reasoning"],
                    "additionalProperties": False,
                },
            },
            "checklist": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string"},
                        "item": {"type": "string"},
                        "raw_value": {"type": "integer", "minimum": 0, "maximum": 2},
                        "evidence": {"type": "array", "items": evidence},
                        "gaps": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["category", "item", "raw_value", "evidence", "gaps"],
                    "additionalProperties": False,
                },
            },
            "summary": {"type": "string"},
        },
        "required": ["criteria", "checklist", "summary"],
        "additionalProperties": False,
    }

    LOGS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        schema_path = Path(tmp) / "schema.json"
        output_path = Path(tmp) / "judge.json"
        schema_path.write_text(json.dumps(schema), encoding="utf-8")
        result = subprocess.run(
            [
                "codex", "exec", "--sandbox", "read-only", "--ephemeral",
                "--ignore-rules", "--skip-git-repo-check", "--model", MODEL,
                "-c", "model_reasoning_effort=high", "--output-schema", str(schema_path),
                "--output-last-message", str(output_path), "-",
            ],
            cwd=tmp, input=prompt, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=int(config.get("judge", {}).get("timeout", 300)),
        )
        (LOGS / "subscription-judge.log").write_text(result.stdout or "", encoding="utf-8")
        if result.returncode != 0 or not output_path.exists():
            return 1
        judged = json.loads(output_path.read_text(encoding="utf-8"))

    expected = {item["name"]: item for item in criteria}
    by_name = {entry.get("name"): entry for entry in judged.get("criteria", []) if entry.get("name") in expected}
    expected_items = {(item["category"], item["item"]) for item in checklist}
    by_item = {
        (entry.get("category"), entry.get("item")): entry
        for entry in judged.get("checklist", [])
        if (entry.get("category"), entry.get("item")) in expected_items
    }
    if set(by_name) != set(expected) or set(by_item) != expected_items:
        return 1
    if len(judged.get("criteria", [])) != len(expected) or len(judged.get("checklist", [])) != len(expected_items):
        return 1
    if not validate_evidence_paths(judged, allowed_paths):
        return 1
    for entry in list(by_name.values()) + list(by_item.values()):
        if entry["raw_value"] > 1 and not entry.get("evidence"):
            return 1

    weighted = sum(by_name[name]["raw_value"] * float(item.get("weight", 1)) for name, item in expected.items())
    total_weight = sum(float(item.get("weight", 1)) for item in expected.values())
    dimension_mean = weighted / total_weight
    dimension_score = (dimension_mean - 1.0) / 4.0
    checklist_score = sum(entry["raw_value"] for entry in by_item.values()) / (2.0 * len(by_item))
    composite = 0.65 * dimension_score + 0.35 * checklist_score

    critical_categories = {
        "required_invariants", "required_personas", "required_flows",
        "required_rules", "required_scenarios",
    }
    critical_missing = [
        f"{category}:{item}"
        for (category, item), entry in by_item.items()
        if category in critical_categories and entry["raw_value"] == 0
    ]
    cap, cap_reason = behavior_cap(critical_missing, quality)
    composite = min(composite, cap)

    details_entries = [by_name[name] for name in expected]
    checklist_entries = [by_item[(item["category"], item["item"])] for item in checklist]
    (LOGS / "reward-details.json").write_text(
        json.dumps(
            {
                "llm_judge": {"criteria": details_entries},
                "checklist": checklist_entries,
                "summary": judged.get("summary", ""),
                "quality_checks": quality,
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    (LOGS / "reward.json").write_text(
        json.dumps(
            {
                "llm_judge": round(composite, 6),
                "composite": round(composite, 6),
                "dimension_score": round(dimension_score, 6),
                "checklist_coverage": round(checklist_score, 6),
                "critical_missing": critical_missing,
                "quality_cap": None if cap == 1.0 else cap,
                "quality_cap_reason": cap_reason,
                "rubric_version": "structured-behavior-v4",
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
