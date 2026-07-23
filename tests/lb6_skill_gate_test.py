import asyncio
import json
import shutil
import tempfile
from pathlib import Path

from lb6_skill_gate import (
    EMPTY_INVENTORY_DIGEST,
    ProtocolInvalidError,
    compute_harbor_skill_digest,
    inspect_container_skill_capture_lifecycle,
    inspect_container_skill_capture_lifecycle_buggy,
    manifest_aggregate_digest,
    parse_agent_skill_locks,
    validate_agent_skill_locks,
    verify_container_skill_capture,
)


root = Path(__file__).resolve().parents[1]
staged_root = root / "benchmarks/lb6/pilot/skill-bundle/staged"
manifest = json.loads((root / "benchmarks/lb6/pilot/skill-bundle/manifest.json").read_text())
expected_digests = manifest["harbor_skill_digests"]

assert compute_harbor_skill_digest(staged_root / "lamina") == expected_digests["lamina"]
assert EMPTY_INVENTORY_DIGEST == manifest_aggregate_digest([])
assert EMPTY_INVENTORY_DIGEST != manifest["aggregate_digest"]

good_locks = [
    {
        "name": name,
        "source": f"/tmp/staged/{name}",
        "digest": expected_digests[name],
    }
    for name in manifest["skills"]
]
assert validate_agent_skill_locks(
    good_locks,
    arm="lamina",
    expected_skill_names=manifest["skills"],
    expected_digests=expected_digests,
)["passed"]

missing = validate_agent_skill_locks(
    good_locks[:-1],
    arm="lamina",
    expected_skill_names=manifest["skills"],
    expected_digests=expected_digests,
)
assert missing["gate"] == "skill_lock_missing"

with tempfile.TemporaryDirectory(prefix="lb6-container-skill-") as temp_name:
    capture_root = Path(temp_name) / "capture"
    shutil.copytree(staged_root, capture_root)
    details = verify_container_skill_capture(capture_root, manifest, require_present=True)
    assert details["container_file_count"] == manifest["file_count"]
    assert details["container_aggregate_digest"] == manifest["aggregate_digest"]

    (capture_root / "lamina" / "extra.txt").write_text("unexpected\n", encoding="utf-8")
    try:
        verify_container_skill_capture(capture_root, manifest, require_present=True)
        raise AssertionError("extra container skill file should fail")
    except ProtocolInvalidError:
        pass

    symlink_root = Path(temp_name) / "symlink"
    shutil.copytree(staged_root / "lamina", symlink_root / "lamina")
    (symlink_root / "lamina" / "link.md").symlink_to(symlink_root / "lamina" / "SKILL.md")
    try:
        verify_container_skill_capture(symlink_root, manifest, require_present=True)
        raise AssertionError("container skill symlink should fail")
    except ProtocolInvalidError:
        pass

    baseline_root = Path(temp_name) / "baseline"
    baseline_root.mkdir()
    baseline = verify_container_skill_capture(baseline_root, manifest, require_present=False)
    assert baseline["container_aggregate_digest"] == EMPTY_INVENTORY_DIGEST

assert parse_agent_skill_locks({"trials": [{"skills": good_locks}]})[0]["name"] == "lamina"


def populate_present_capture_root(capture_root: Path) -> bool:
    if capture_root.exists():
        shutil.rmtree(capture_root)
    shutil.copytree(staged_root, capture_root)
    return False


def populate_missing_capture_root(_capture_root: Path) -> bool:
    return True


fixed = inspect_container_skill_capture_lifecycle(
    container_path="/home/agent/.cursor/skills",
    manifest=manifest,
    arm="lamina",
    populate_capture_root=populate_present_capture_root,
)
assert fixed["container_file_count"] == manifest["file_count"]
assert fixed["container_aggregate_digest"] == manifest["aggregate_digest"]

baseline_fixed = inspect_container_skill_capture_lifecycle(
    container_path="/home/agent/.cursor/skills",
    manifest=manifest,
    arm="direct",
    populate_capture_root=populate_missing_capture_root,
)
assert baseline_fixed["container_aggregate_digest"] == EMPTY_INVENTORY_DIGEST
assert baseline_fixed["lamina_skill_absent"] is True


def run_buggy_lifecycle() -> None:
    inspect_container_skill_capture_lifecycle_buggy(
        container_path="/home/agent/.cursor/skills",
        manifest=manifest,
        arm="lamina",
        populate_capture_root=populate_present_capture_root,
    )


try:
    run_buggy_lifecycle()
    raise AssertionError("buggy capture lifecycle should fail after tempdir teardown")
except (ProtocolInvalidError, FileNotFoundError, OSError):
    pass


async def async_fixed_lifecycle() -> dict:
    return await asyncio.to_thread(
        inspect_container_skill_capture_lifecycle,
        container_path="/home/agent/.cursor/skills",
        manifest=manifest,
        arm="lamina",
        populate_capture_root=populate_present_capture_root,
    )


async def async_buggy_lifecycle() -> dict:
    return await asyncio.to_thread(
        inspect_container_skill_capture_lifecycle_buggy,
        container_path="/home/agent/.cursor/skills",
        manifest=manifest,
        arm="lamina",
        populate_capture_root=populate_present_capture_root,
    )


async_details = asyncio.run(async_fixed_lifecycle())
assert async_details["container_aggregate_digest"] == manifest["aggregate_digest"]

try:
    asyncio.run(async_buggy_lifecycle())
    raise AssertionError("async buggy capture lifecycle should fail after tempdir teardown")
except (ProtocolInvalidError, FileNotFoundError, OSError):
    pass

print("lb6 skill gate python tests passed")
