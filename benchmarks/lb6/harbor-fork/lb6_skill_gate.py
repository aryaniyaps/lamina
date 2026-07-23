"""Pure skill-gate helpers for LB6 Harbor patch (testable without Harbor imports)."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import tempfile
from pathlib import Path

DIGEST_PREFIX = "sha256:"


class ProtocolInvalidError(RuntimeError):
    pass


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compute_harbor_skill_digest(skill_dir: Path) -> str:
    hasher = hashlib.sha256()
    for file_path in sorted(path for path in skill_dir.rglob("*") if path.is_file()):
        relative_path = file_path.relative_to(skill_dir).as_posix()
        content_digest = hashlib.sha256(file_path.read_bytes()).hexdigest()
        hasher.update(relative_path.encode())
        hasher.update(b"\0")
        hasher.update(content_digest.encode())
        hasher.update(b"\0")
    return f"{DIGEST_PREFIX}{hasher.hexdigest()}"


def build_expected_harbor_skill_digests(staged_root: Path, skill_names: list[str]) -> dict[str, str]:
    return {
        skill_name: compute_harbor_skill_digest(staged_root / skill_name)
        for skill_name in sorted(skill_names)
    }


def _normalize_lock_entry(item: object) -> dict | None:
    if not isinstance(item, dict):
        return None
    name = item.get("name")
    source = item.get("source") or item.get("path")
    digest = item.get("digest")
    if not isinstance(name, str) or not isinstance(source, str) or not isinstance(digest, str):
        return None
    return {
        "name": name,
        "source": source.replace("\\", "/"),
        "digest": digest,
        "git_url": item.get("git_url") if isinstance(item.get("git_url"), str) else None,
        "git_commit_id": item.get("git_commit_id") if isinstance(item.get("git_commit_id"), str) else None,
    }


def parse_agent_skill_locks(lock: dict | None) -> list[dict]:
    if not lock:
        return []
    entries: list[dict] = []

    def push(items: list | None) -> None:
        for item in items or []:
            if isinstance(item, str):
                entries.append(
                    {
                        "name": Path(item).name,
                        "source": item.replace("\\", "/"),
                        "digest": None,
                        "legacy": True,
                    }
                )
                continue
            parsed = _normalize_lock_entry(item)
            if parsed:
                entries.append(parsed)

    for trial in lock.get("trials") or []:
        if isinstance(trial, dict):
            push(trial.get("skills"))
    push(lock.get("skills"))
    agent = lock.get("agent") or {}
    push(agent.get("skills"))
    return entries


def validate_agent_skill_locks(
    locks: list[dict],
    *,
    arm: str,
    expected_skill_names: list[str],
    expected_digests: dict[str, str] | None = None,
) -> dict:
    expected_names = sorted(expected_skill_names)
    if arm != "lamina":
        if not locks:
            return {"passed": True, "locks": [], "gate": "baseline_skill_absent", "reason": None}
        contaminated = [
            entry
            for entry in locks
            if entry.get("name") in expected_names
            or "/lamina" in entry.get("source", "")
            or "/skills/lamina" in entry.get("source", "")
        ]
        if contaminated:
            return {
                "passed": False,
                "locks": locks,
                "gate": "baseline_skill_contamination",
                "reason": f"{arm} arm lock must not inject Lamina skills",
            }
        return {"passed": True, "locks": locks, "gate": "baseline_skill_absent", "reason": None}

    if not locks:
        return {
            "passed": False,
            "locks": locks,
            "gate": "skill_injection_missing",
            "reason": "Harbor lock recorded empty injected skill sources for lamina arm",
        }

    if any(entry.get("legacy") or not entry.get("digest") for entry in locks):
        return {
            "passed": False,
            "locks": locks,
            "gate": "skill_lock_schema_invalid",
            "reason": "lamina arm requires Harbor AgentSkillLock entries with name, source, and digest",
        }

    by_name: dict[str, dict] = {}
    for entry in locks:
        name = entry["name"]
        if name in by_name:
            return {
                "passed": False,
                "locks": locks,
                "gate": "skill_lock_duplicate",
                "reason": f"duplicate skill lock name: {name}",
            }
        by_name[name] = entry

    actual_names = sorted(by_name)
    if actual_names != expected_names:
        missing = [name for name in expected_names if name not in by_name]
        extra = [name for name in actual_names if name not in expected_names]
        return {
            "passed": False,
            "locks": locks,
            "gate": "skill_lock_missing" if missing else "skill_lock_extra",
            "reason": (
                f"missing skill locks: {', '.join(missing)}"
                if missing
                else f"unexpected skill locks: {', '.join(extra)}"
            ),
        }

    if expected_digests:
        for name in expected_names:
            expected = expected_digests.get(name)
            actual = by_name[name]["digest"]
            if expected != actual:
                return {
                    "passed": False,
                    "locks": locks,
                    "gate": "skill_lock_digest_mismatch",
                    "reason": f"digest mismatch for {name}",
                    "expected": expected,
                    "actual": actual,
                }

    for entry in locks:
        digest = entry["digest"]
        if not digest.startswith(DIGEST_PREFIX) or len(digest) != len(DIGEST_PREFIX) + 64:
            return {
                "passed": False,
                "locks": locks,
                "gate": "skill_lock_digest_invalid",
                "reason": f"invalid digest format for {entry['name']}",
            }

    return {"passed": True, "locks": locks, "gate": "skill_lock_valid", "reason": None}


def extract_lock_skill_sources(lock: dict | None) -> list[str]:
    return sorted({entry["source"] for entry in parse_agent_skill_locks(lock) if entry.get("source")})


def manifest_aggregate_digest(files: list[dict]) -> str:
    return hashlib.sha256(json.dumps(files, separators=(",", ":")).encode("utf-8")).hexdigest()


EMPTY_INVENTORY_DIGEST = manifest_aggregate_digest([])


def _manifest_aggregate_digest(files: list[dict]) -> str:
    return manifest_aggregate_digest(files)


def _inventory_from_capture(captured_root: Path, skill_names: list[str]) -> list[dict]:
    files: list[dict] = []
    for skill_name in sorted(skill_names):
        skill_root = captured_root / skill_name
        if not skill_root.is_dir():
            raise ProtocolInvalidError(f"container skill directory missing: {skill_name}")
        for path in sorted(skill_root.rglob("*")):
            if path.is_symlink():
                raise ProtocolInvalidError(f"container skill symlink rejected: {skill_name}/{path.relative_to(skill_root).as_posix()}")
            if path.is_dir():
                continue
            if not path.is_file():
                raise ProtocolInvalidError(f"container skill non-regular file rejected: {skill_name}/{path.relative_to(skill_root).as_posix()}")
            rel = path.relative_to(skill_root).as_posix()
            files.append(
                {
                    "skill": skill_name,
                    "path": f"{skill_name}/{rel}",
                    "sha256": _sha256_file(path),
                    "size": path.stat().st_size,
                }
            )
    files.sort(key=lambda item: item["path"].casefold())
    return files


def verify_container_skill_capture(
    captured_root: Path,
    manifest: dict,
    *,
    require_present: bool,
) -> dict:
    skill_names = list(manifest.get("skills") or [])
    expected_files = list(manifest.get("files") or [])
    expected_by_path = {entry["path"]: entry for entry in expected_files}

    if not require_present:
        for skill_name in skill_names:
            if (captured_root / skill_name).exists():
                raise ProtocolInvalidError(f"baseline arm must not register Lamina skill: {skill_name}")
        return {
            "container_path": str(captured_root),
            "container_file_count": 0,
            "container_aggregate_digest": EMPTY_INVENTORY_DIGEST,
            "lamina_skill_absent": True,
        }

    if not captured_root.is_dir():
        raise ProtocolInvalidError("container skill root missing for lamina arm")

    inventory = _inventory_from_capture(captured_root, skill_names)
    aggregate_digest = _manifest_aggregate_digest(inventory)
    expected_aggregate = manifest.get("aggregate_digest")
    if aggregate_digest != expected_aggregate:
        raise ProtocolInvalidError("container skill aggregate digest mismatch")

    if len(inventory) != len(expected_files):
        raise ProtocolInvalidError("container skill file count mismatch")

    for entry in inventory:
        expected = expected_by_path.get(entry["path"])
        if not expected:
            raise ProtocolInvalidError(f"unexpected container skill file: {entry['path']}")
        if expected["sha256"] != entry["sha256"] or expected["size"] != entry["size"]:
            raise ProtocolInvalidError(f"container skill digest mismatch: {entry['path']}")

    return {
        "container_path": str(captured_root),
        "container_file_count": len(inventory),
        "container_aggregate_digest": aggregate_digest,
        "lamina_skill_absent": False,
    }


def inspect_container_skill_capture_lifecycle(
    *,
    container_path: str,
    manifest: dict,
    arm: str,
    populate_capture_root,
) -> dict:
    """Populate and verify a container skill capture within one tempdir lifetime."""
    with tempfile.TemporaryDirectory(prefix="lb6-skill-capture-") as temp_name:
        capture_root = Path(temp_name) / "skills"
        capture_root.mkdir()
        missing = populate_capture_root(capture_root)
        if missing:
            if arm == "lamina":
                raise ProtocolInvalidError("container skill root missing for lamina arm")
            return {
                "container_path": container_path,
                "container_file_count": 0,
                "container_aggregate_digest": EMPTY_INVENTORY_DIGEST,
                "lamina_skill_absent": True,
            }
        details = verify_container_skill_capture(capture_root, manifest, require_present=(arm == "lamina"))
        details["container_path"] = container_path
        return details


def inspect_container_skill_capture_lifecycle_buggy(
    *,
    container_path: str,
    manifest: dict,
    arm: str,
    populate_capture_root,
) -> dict:
    """Regression reproducer: verify after the capture tempdir is destroyed."""
    capture_root: Path | None = None
    with tempfile.TemporaryDirectory(prefix="lb6-skill-capture-") as temp_name:
        capture_root = Path(temp_name) / "skills"
        capture_root.mkdir()
        populate_capture_root(capture_root)
    assert capture_root is not None
    if arm != "lamina":
        return verify_container_skill_capture(capture_root, manifest, require_present=False)
    return verify_container_skill_capture(capture_root, manifest, require_present=True)
