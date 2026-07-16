"""
Shared LaminaBench verifier logic for Harbor Rewardkit (Design C Option D).
Claim score is llm_judge; this module captures implementation artifacts.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


MAX_ARTIFACT_CHARS = 180_000
# Allocate a bounded but adaptive share to each source file. Large files are
# sampled across their full length so agents cannot win by front-loading rubric
# phrases, and monoliths are not judged only from their first component.
CAPTURE_FILE_CHARS = 3_500
MAX_CAPTURE_FILE_CHARS = 60_000

SKIP_DIRS = {
    ".lamina",
    "node_modules",
    ".git",
    ".next",
    ".react-router",
    ".svelte-kit",
    ".nuxt",
    ".output",
    "dist",
    "build",
    "out",
    "target",
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
    # Agent-authored tests are not independent product evidence. Excluding
    # them prevents assertion names, fixtures, and comments from standing in
    # for reachable application behavior.
    "test",
    "tests",
    "__tests__",
    "spec",
    "specs",
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
    "data_state_integrity",
    "systems_judgment",
    "ux_workflow_expression",
    "accessibility_quality",
    "brownfield_fit",
    "implementation_readiness",
    "overall_product_behavior",
]

ARTIFACT_OUT = Path("/logs/verifier/implementation.md")
ARTIFACT_MANIFEST_OUT = Path("/logs/verifier/artifact-manifest.json")
BASELINE_MANIFEST_PATH = Path("/tests/baseline-manifest.json")
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
            if re.search(r"(^|[._-])(test|spec)([._-]|$)", entry.name, re.I):
                continue
            if re.search(r"(^|[._-])generated([._-]|$)", entry.name, re.I):
                continue
            try:
                text = entry.read_text(encoding="utf-8", errors="replace")
                if not text.strip():
                    continue
                files.append((rel, text))
            except OSError:
                continue

    walk(workspace, "")
    files.sort(key=lambda item: (path_priority(item[0]), item[0]))
    return files


def file_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def representative_excerpt(text: str, limit: int) -> str:
    """Sample head/interior/tail spans instead of trusting a large file's head."""
    if len(text) <= limit:
        return text
    pieces = 4
    marker_budget = 800
    span = max(300, (limit - marker_budget) // pieces)
    last = max(0, len(text) - span)
    offsets = [0, last // 3, (2 * last) // 3, last]
    blocks = []
    for index, offset in enumerate(offsets, start=1):
        blocks.append(
            f"/* representative excerpt {index}/{pieces} at char {offset} */\n"
            + text[offset : offset + span]
        )
    return "\n/* … omitted between representative excerpts … */\n".join(blocks)[:limit]


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


def load_baseline_hashes(path: Path = BASELINE_MANIFEST_PATH) -> dict[str, str]:
    """Load the hidden pre-agent source snapshot used for delta-aware capture."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        entry["path"]: entry["sha256"]
        for entry in data.get("files", [])
        if isinstance(entry, dict)
        and isinstance(entry.get("path"), str)
        and isinstance(entry.get("sha256"), str)
    }


def append_representative_files(
    parts: list[str],
    files: list[tuple[str, str]],
    included: list[str],
    total: int,
    limit: int,
) -> int:
    """Append a round-robin, subtree-balanced group up to an absolute limit."""
    buckets: dict[tuple[int, str], list[tuple[str, str]]] = {}
    for rel, text in files:
        key = (path_priority(rel), coverage_bucket(rel))
        buckets.setdefault(key, []).append((rel, text))

    available = max(0, limit - total)
    full_capture_estimate = sum(len(rel) + len(text) + 24 for rel, text in files)
    if full_capture_estimate <= available:
        per_file_budget = MAX_CAPTURE_FILE_CHARS
    else:
        per_file_budget = min(
            MAX_CAPTURE_FILE_CHARS,
            max(CAPTURE_FILE_CHARS, available // max(1, len(files))),
        )
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
            text = representative_excerpt(text, per_file_budget)
            block = f"## {rel}\n```\n{text}\n```\n\n"
            if total + len(block) > limit:
                # Try a truncated slice of this file before giving up on the bucket.
                room = limit - total - len(f"## {rel}\n```\n\n```\n\n") - 40
                if room < 400:
                    continue
                text = text[:room] + "\n/* … truncated for scoring … */\n"
                block = f"## {rel}\n```\n{text}\n```\n\n"
                if total + len(block) > limit:
                    continue
            parts.append(block)
            total += len(block)
            included.append(rel)
            progressed = True
        if not progressed:
            break
    return total


def capture_implementation_artifact(
    workspace: Path,
    agent_output: str = "",
    baseline_hashes: dict[str, str] | None = None,
) -> str:
    """Bundle source with agent-modified files ahead of representative context."""
    files = walk_implementation(workspace)
    if baseline_hashes is None:
        baseline_hashes = load_baseline_hashes()

    changed: list[tuple[str, str]] = []
    unchanged: list[tuple[str, str]] = []
    for rel, text in files:
        if baseline_hashes and baseline_hashes.get(rel) == file_sha256(text):
            unchanged.append((rel, text))
        elif baseline_hashes:
            changed.append((rel, text))
        else:
            unchanged.append((rel, text))

    parts = ["# LaminaBench implementation capture\n"]
    included: list[str] = []
    total = len(parts[0])

    if changed:
        heading = "\n# Agent-modified application source\n\n"
        parts.append(heading)
        total += len(heading)
        # Reserve most of the context for the actual implementation delta.
        # Unchanged fixture source still receives the remaining context so the
        # judge can assess brownfield fit and connected call sites.
        changed_limit = min(MAX_ARTIFACT_CHARS - 4_000, total + 132_000)
        total = append_representative_files(
            parts, changed, included, total, changed_limit
        )

        if unchanged and total < MAX_ARTIFACT_CHARS - 800:
            heading = "\n# Representative existing application context\n\n"
            parts.append(heading)
            total += len(heading)
            total = append_representative_files(
                parts,
                unchanged,
                included,
                total,
                MAX_ARTIFACT_CHARS - 400,
            )
    else:
        # No baseline is available for legacy/direct callers, or the agent made
        # no source change. Preserve the prior subtree-balanced whole-tree mode.
        total = append_representative_files(
            parts,
            unchanged,
            included,
            total,
            MAX_ARTIFACT_CHARS - 400,
        )

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
        manifest.update(
            {
                "capture_mode": "delta_plus_context" if changed else "representative_tree",
                "changed_file_count": len(changed),
                "changed_files_included": sum(1 for rel in included if rel in {p for p, _ in changed}),
            }
        )
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
