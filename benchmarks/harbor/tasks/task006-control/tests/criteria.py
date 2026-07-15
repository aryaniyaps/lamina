"""
Shared LaminaBench verifier logic for Harbor Rewardkit (Design C Option D).
Claim score is llm_judge; this module captures implementation artifacts.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


MAX_ARTIFACT_CHARS = 96_000
MAX_FILE_BYTES = 48_000
# Oversized source files contribute a truncated head instead of being skipped.
TRUNCATED_FILE_CHARS = 12_000
# Bound every captured file, not only oversized source files. A few 15–30 KB
# modules otherwise consume the artifact cap before peer UI/workflow subtrees
# receive any evidence.
CAPTURE_FILE_CHARS = 3_500

SKIP_DIRS = {
    ".lamina",
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    ".codex",
    ".agents",
    ".claude",
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
    ".css",
    ".scss",
}

ROOT_SOURCE_FILES = {
    "package.json",
    "tsconfig.json",
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
REWARD_PATH = Path("/logs/verifier/reward.json")
REWARD_DETAILS_PATH = Path("/logs/verifier/reward-details.json")
VERIFIER_META_PATH = Path("/logs/verifier/verifier-meta.json")


def path_priority(rel: str) -> int:
    if re.search(r"(^|/)tests?/", rel, re.I) or re.search(r"\.(test|spec)\.", rel, re.I):
        return 2
    if re.match(
        r"^(src|app|apps|lib|pkg|internal|server|api|backend|packages|web|mobile|frontend)/",
        rel,
    ):
        return 0
    return 1


def coverage_bucket(rel: str) -> str:
    """Group source by logical subtree so large captures stay representative."""
    parts = Path(rel).parts
    if not parts:
        return "root"
    if len(parts) > 2 and parts[0] in {"src", "app", "web", "mobile", "frontend"} and parts[1] in {
        "screen",
        "screens",
        "page",
        "pages",
        "route",
        "routes",
        "view",
        "views",
    }:
        # Each user-facing surface gets first-round representation instead of
        # one alphabetically early screen standing in for the whole product.
        return "/".join(parts[:3])
    if parts[0] in {"src", "app", "apps", "lib", "pkg", "internal", "server", "api", "backend", "packages", "web", "mobile", "frontend"}:
        return "/".join(parts[:2]) if len(parts) > 1 else parts[0]
    return parts[0]


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
            if entry.suffix.lower() not in SOURCE_EXT and not (
                not prefix and entry.name in ROOT_SOURCE_FILES
            ):
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
    """Bundle source for scoring with representative logical-subtree coverage."""
    files = walk_implementation(workspace)
    buckets: dict[tuple[int, str], list[tuple[str, str]]] = {}
    for rel, text in files:
        key = (path_priority(rel), coverage_bucket(rel))
        buckets.setdefault(key, []).append((rel, text))

    parts = ["# LaminaBench implementation capture\n"]
    included: list[str] = []
    total = len(parts[0])
    # Round-robin across logical subtrees. Alphabetical file walking alone can
    # exhaust the cap on early folders (for example auth/domain) and omit the
    # UI, workflow engine, or entry point that proves the product is buildable.
    # Priority still determines the bucket order; every bucket gets a chance
    # before a second file is taken from any bucket.
    order = sorted(buckets)
    indices = {key: 0 for key in order}

    while True:
        progressed = False
        for key in order:
            i = indices[key]
            if i >= len(buckets[key]):
                continue
            rel, text = buckets[key][i]
            indices[key] = i + 1
            if len(text) > CAPTURE_FILE_CHARS:
                text = text[:CAPTURE_FILE_CHARS] + "\n/* … truncated for broad source coverage … */\n"
            block = f"## {rel}\n```\n{text}\n```\n\n"
            if total + len(block) > MAX_ARTIFACT_CHARS:
                # Try a truncated slice of this file before giving up on the bucket.
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
        logs_dir / "agent" / "codex.txt",
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



def likert_norm_to_mean(norm: float) -> float:
    return round(1.0 + max(0.0, min(1.0, norm)) * 4.0, 2)
