"""
Shared LaminaBench verifier logic for Harbor Rewardkit.
Canonical weights match benchmarks/release.yaml golden_field_weights.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

MAX_ARTIFACT_CHARS = 96_000
MAX_FILE_BYTES = 48_000
# Oversized source files contribute a truncated head instead of being skipped.
TRUNCATED_FILE_CHARS = 12_000

SKIP_DIRS = {
    ".lamina",
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    ".claude",
    ".codex",
    ".opencode",
    "coverage",
    "__pycache__",
    ".venv",
    "vendor",
    ".turbo",
    ".cache",
    ".pnpm-store",
}

SKIP_ROOT_FILES = {
    "bench-context.md",
    "bench-plan.md",
    "bench-build-order.md",
    "bench-review.md",
    "bench-fix-list.md",
    "product-plan.md",
    "product-build-order.md",
    "product-review.md",
    "product-fix-list.md",
    "bench-product-brief.md",
    "bench-audit-report.md",
    "bench-post-verify-report.md",
}

SOURCE_EXT = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".swift",
    ".vue",
    ".svelte",
    ".sql",
    ".prisma",
    ".graphql",
    ".rb",
    ".php",
    ".cs",
    ".html",
}

GOLDEN_FIELD_WEIGHTS = {
    "required_invariants": 2,
    "required_entities": 2,
    "required_scenarios": 2,
    "required_tradeoffs": 2,
    "required_personas": 1,
    "required_flows": 1,
    "required_rules": 1,
    "required_edge_cases": 1,
    "required_a11y": 1,
    "required_findings": 1,
}

ALIASES = {
    "one_active_budget_per_household": [
        "single active budget",
        "one budget per household",
        "only one active budget",
    ],
    "partner_privacy_boundary": [
        "partner privacy",
        "privacy between partners",
        "partner data boundary",
    ],
    "no_investment_advice_display": [
        "no investment advice",
        "exclude investment advice",
        "without investment advice",
    ],
    "sync_failure_recovery": [
        "sync failure",
        "when sync fails",
        "recover from sync",
    ],
    "zero_income_month": [
        "zero income",
        "no income month",
        "month with no income",
    ],
    "duplicate_transaction_handling": [
        "duplicate transaction",
        "dedupe transaction",
        "duplicate transactions",
    ],
    "order_total_matches_line_items": [
        "order total matches",
        "total equals line items",
        "line item total",
    ],
    "payment_required_before_confirmation": [
        "payment before confirm",
        "pay before confirmation",
        "payment required",
    ],
    "payment_declined_recovery": [
        "payment declined",
        "card declined",
        "declined payment",
    ],
    "session_timeout_mid_checkout": [
        "session timeout",
        "session expired",
        "timeout mid checkout",
    ],
}

CLARIFY_MARKERS = [
    re.compile(r"##\s*lamina:\s*clarification needed", re.I),
    re.compile(r"blocked before artifact generation", re.I),
    re.compile(r"###\s*clarifying questions", re.I),
    re.compile(r"clarification needed before artifact", re.I),
]

CRITERIA_KEYS = [
    "domain_system_structure",
    "invariants_product_rules",
    "actors_permissions",
    "workflow_quality",
    "scenario_edge_coverage",
    "systems_judgment",
    "ux_expression_under_rules",
    "brownfield_fit",
    "implementation_readiness",
    "overall_product_behavior",
]

ARTIFACT_OUT = Path("/logs/verifier/implementation.md")
ARTIFACT_MANIFEST_OUT = Path("/logs/verifier/artifact-manifest.json")
META_PATH = Path("/tests/task-meta.json")
GOLDEN_PATH = Path("/tests/golden.yaml")
REWARD_PATH = Path("/logs/verifier/reward.json")
REWARD_DETAILS_PATH = Path("/logs/verifier/reward-details.json")
VERIFIER_META_PATH = Path("/logs/verifier/verifier-meta.json")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().replace("_", " ").replace("-", " ")).strip()


def read_yaml(path: Path) -> dict:
    if yaml is not None:
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    text = path.read_text(encoding="utf-8")
    return json.loads(json.dumps(_parse_simple_yaml(text)))


def _parse_simple_yaml(text: str) -> dict:
    """Minimal YAML reader for golden checklists when PyYAML is unavailable."""
    out: dict[str, list[str]] = {}
    current: str | None = None
    for line in text.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        if not line.startswith(" ") and line.endswith(":"):
            current = line[:-1].strip()
            out[current] = []
            continue
        if current and line.strip().startswith("- "):
            out[current].append(line.strip()[2:].strip().strip('"').strip("'"))
    return out


def path_priority(rel: str) -> int:
    if re.match(
        r"^(src|app|apps|lib|pkg|internal|server|api|backend|packages|web|mobile|frontend)/",
        rel,
    ):
        return 0
    if re.search(r"(^|/)tests?/", rel, re.I) or re.search(r"\.(test|spec)\.", rel, re.I):
        return 2
    return 1


def walk_implementation(workspace: Path) -> list[tuple[str, str]]:
    files: list[tuple[str, str]] = []

    def walk(dir_path: Path, prefix: str) -> None:
        if not dir_path.exists():
            return
        for entry in sorted(dir_path.iterdir()):
            rel = f"{prefix}/{entry.name}" if prefix else entry.name
            if entry.is_dir():
                if entry.name in SKIP_DIRS:
                    continue
                walk(entry, rel)
                continue
            if not prefix and entry.name in SKIP_ROOT_FILES:
                continue
            if entry.suffix.lower() not in SOURCE_EXT:
                continue
            try:
                text = entry.read_text(encoding="utf-8", errors="replace")
                if not text.strip():
                    continue
                if entry.stat().st_size > MAX_FILE_BYTES or len(text) > MAX_FILE_BYTES:
                    text = text[:TRUNCATED_FILE_CHARS] + "\n/* … truncated for scoring … */\n"
                files.append((rel, text))
            except OSError:
                continue

    walk(workspace, "")
    files.sort(key=lambda item: (path_priority(item[0]), item[0]))
    return files


def file_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def build_artifact_manifest(workspace: Path, included_rels: list[str] | None = None) -> dict:
    """Content-addressed snapshot of scored source — compare to exported workspaces."""
    files = walk_implementation(workspace)
    by_rel = {rel: text for rel, text in files}
    entries = []
    if included_rels is None:
        included_rels = [rel for rel, _ in files]
    for rel in included_rels:
        text = by_rel.get(rel)
        if text is None:
            continue
        entries.append(
            {
                "path": rel,
                "sha256": file_sha256(text),
                "chars": len(text),
            }
        )
    digest_src = "\n".join(f"{e['path']}:{e['sha256']}" for e in entries)
    return {
        "schema": "lamina-bench-artifact-manifest/v1",
        "file_count": len(entries),
        "files": entries,
        "tree_sha256": hashlib.sha256(digest_src.encode("utf-8")).hexdigest(),
    }


def capture_implementation_artifact(workspace: Path, agent_output: str = "") -> str:
    """Bundle source for scoring with stratified path coverage (not src/app-only)."""
    files = walk_implementation(workspace)
    bands: dict[int, list[tuple[str, str]]] = {0: [], 1: [], 2: []}
    for rel, text in files:
        bands[path_priority(rel)].append((rel, text))

    parts = ["# LaminaBench implementation capture\n"]
    included: list[str] = []
    total = len(parts[0])
    # Round-robin across priority bands so OSS trees outside src/app still score.
    indices = {0: 0, 1: 0, 2: 0}
    order = (0, 1, 2)

    while True:
        progressed = False
        for band in order:
            i = indices[band]
            if i >= len(bands[band]):
                continue
            rel, text = bands[band][i]
            indices[band] = i + 1
            block = f"## {rel}\n```\n{text}\n```\n\n"
            if total + len(block) > MAX_ARTIFACT_CHARS:
                # Try a truncated slice of this file before giving up on the band.
                room = MAX_ARTIFACT_CHARS - total - len(f"## {rel}\n```\n\n```\n\n") - 40
                if room < 400:
                    continue
                text = text[:room] + "\n/* … truncated for scoring … */\n"
                block = f"## {rel}\n```\n{text}\n```\n\n"
                if total + len(block) > MAX_ARTIFACT_CHARS:
                    continue
            parts.append(block)
            total += len(block)
            included.append(rel)
            progressed = True
        if not progressed:
            break

    if included:
        preview = ", ".join(included[:10])
        suffix = ", …" if len(included) > 10 else ""
        parts.insert(
            1,
            f"Captured {len(included)} source file(s): {preview}{suffix}\n\n",
        )
    elif agent_output.strip():
        parts.append(
            "## agent_stdout (no source files found)\n```\n"
            f"{agent_output.strip()[:12_000]}\n```\n\n"
        )

    out = "".join(parts)
    if len(out) > MAX_ARTIFACT_CHARS:
        out = out[:MAX_ARTIFACT_CHARS] + "\n\n[truncated for scoring]"

    # Side-channel provenance for host export / debug (not part of scored text).
    try:
        ARTIFACT_MANIFEST_OUT.parent.mkdir(parents=True, exist_ok=True)
        manifest = build_artifact_manifest(workspace, included)
        ARTIFACT_MANIFEST_OUT.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass

    return out


def is_artifact_valid(artifact: str) -> bool:
    return bool(artifact) and bool(re.search(r"Captured \d+ source file\(s\):", artifact))


def read_agent_output(logs_dir: Path = Path("/logs")) -> str:
    candidates = [
        logs_dir / "agent" / "stdout.txt",
        logs_dir / "agent" / "output.txt",
        logs_dir / "agent" / "claude-code.txt",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.read_text(encoding="utf-8", errors="replace")
    agent_dir = logs_dir / "agent"
    if not agent_dir.exists():
        return ""
    for path in sorted(agent_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".txt", ".log", ".md", ".jsonl"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            if len(text) > 100:
                return text[:50_000]
        except OSError:
            continue
    return ""


def is_clarify_output(output: str) -> bool:
    if not output:
        return False
    hits = sum(1 for marker in CLARIFY_MARKERS if marker.search(output))
    return hits >= 2 or bool(re.search(r"##\s*lamina:\s*clarification needed", output, re.I))


def phrases_for(item: str) -> list[str]:
    key = str(item)
    phrases = [normalize(key)]
    if key in ALIASES:
        phrases.extend(normalize(alias) for alias in ALIASES[key])
    return phrases


def phrase_matches(phrase: str, text: str) -> bool:
    words = [word for word in phrase.split() if len(word) > 2]
    if not words:
        return bool(phrase) and phrase in text
    if phrase in text:
        return True
    matched = sum(1 for word in words if word in text)
    return matched >= (len(words) + 1) // 2


def item_matches(item: str, text: str) -> bool:
    return any(phrase_matches(phrase, text) for phrase in phrases_for(item))


def score_golden(golden: dict, artifact_text: str) -> dict:
    text = normalize(artifact_text)
    checks: list[dict] = []
    total_weight = 0.0
    passed_weight = 0.0

    for field, weight in GOLDEN_FIELD_WEIGHTS.items():
        items = golden.get(field) or []
        if not items:
            continue
        for item in items:
            total_weight += weight
            passed = item_matches(str(item), text)
            if passed:
                passed_weight += weight
            checks.append(
                {
                    "field": field,
                    "item": item,
                    "pass": passed,
                    "weight": weight,
                    "method": "phrase",
                }
            )

    coverage_score = round((passed_weight / total_weight) * 100) if total_weight else 0
    coverage_norm = passed_weight / total_weight if total_weight else 0.0
    return {
        "coverage_score": coverage_score,
        "coverage_norm": coverage_norm,
        "checks": checks,
        "passed": passed_weight,
        "total": total_weight,
    }


def likert_norm_to_mean(norm: float) -> float:
    return round(1.0 + max(0.0, min(1.0, norm)) * 4.0, 2)


def build_judge_context(task_meta: dict, golden: dict) -> str:
    lines = [
        "# LaminaBench judge context",
        "",
        "## Task description",
        task_meta.get("prompt") or task_meta.get("task_id") or "",
        "",
        "## Behavioral reference checklist",
        "Use as a **rubric for product behavior**, not a phrase hunt.",
        "Credit implemented behavior (types, handlers, UI, validation, filters, empty/error states).",
        "Do **not** require checklist id strings or slogan comments.",
        "Negations/bans: absence or explicit rejection counts — the ban phrase need not appear.",
        "Trade-offs/a11y: look for chosen behavior and accessible hooks, not snake_case labels.",
        "Cite evidence (path/symbol/control) in criterion reasoning.",
        "",
    ]
    for field, items in golden.items():
        if not field.startswith("required_") or not isinstance(items, list) or not items:
            continue
        if field == "required_sections":
            continue  # planning-era hints; not behavioral claim surface
        lines.append(f"### {field}")
        for item in items:
            lines.append(f"- {item}")
        lines.append("")
    return "\n".join(lines).strip() + "\n"
