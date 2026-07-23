"""Commit-pinned Harbor 0.18.0 isolation patch for the LB6 development spike.

This patch deliberately replaces stock multi-step verification for tasks carrying
metadata.host_sealed_supervisor_required=true. Agent work still runs through
Harbor and its Cursor adapter. Snapshot sealing and behavior verification are
owned by this host process and fail closed.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
import uuid
from pathlib import Path

from harbor.models.trial.result import ExceptionInfo, TimingInfo
from harbor.models.verifier.result import VerifierResult
from harbor.trial.multi_step import MultiStepTrial

from lb6_skill_gate import (
    ProtocolInvalidError as SkillGateError,
    EMPTY_INVENTORY_DIGEST,
    extract_lock_skill_sources,
    parse_agent_skill_locks,
    validate_agent_skill_locks,
    verify_container_skill_capture,
)


PATCH_VERSION = "lb6-host-seal-v1"
EXCLUDED_DIRS = {".git", ".agents", ".cursor", "node_modules", "dist", "build", "coverage"}
EXCLUDED_FILES = {"skills-lock.json", ".env", ".env.local"}


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


def _run(command: list[str], *, timeout: int = 120, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip().replace("\n", " ")[-500:]
        raise ProtocolInvalidError(
            f"host command failed ({result.returncode}): {command[0]} {command[1] if len(command) > 1 else ''}: {detail}"
        )
    return result


def _fsync_tree(root: Path) -> None:
    for path in sorted(root.rglob("*")):
        if path.is_file():
            with path.open("rb") as handle:
                os.fsync(handle.fileno())
    for path in sorted((p for p in root.rglob("*") if p.is_dir()), reverse=True):
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    fd = os.open(root, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _normalise(raw: Path, target: Path, *, treatment_only: bool = False) -> dict:
    target.mkdir(parents=True, exist_ok=False)
    inventory: list[dict] = []
    source = raw / ".lamina" if treatment_only else raw
    if treatment_only and not source.exists():
        return {"files": [], "digest": _sha256_bytes(_canonical([]))}

    for path in sorted(source.rglob("*")):
        relative = path.relative_to(raw)
        parts = set(relative.parts)
        if not treatment_only and ".lamina" in parts:
            continue
        if parts & EXCLUDED_DIRS or path.name in EXCLUDED_FILES:
            continue
        if path.is_symlink():
            raise ProtocolInvalidError(f"symlink rejected during normalisation: {relative.as_posix()}")
        if path.is_dir():
            (target / relative).mkdir(parents=True, exist_ok=True)
            continue
        if not path.is_file():
            raise ProtocolInvalidError(f"non-regular path rejected: {relative.as_posix()}")
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        executable = bool(path.stat().st_mode & stat.S_IXUSR)
        os.chmod(destination, 0o555 if executable else 0o444)
        inventory.append(
            {
                "path": relative.as_posix(),
                "sha256": _sha256_file(destination),
                "size": destination.stat().st_size,
                "mode": "0555" if executable else "0444",
            }
        )

    digest = _sha256_bytes(_canonical(inventory))
    return {"files": inventory, "digest": digest}


def _append_ledger(trial: MultiStepTrial, event: str, details: dict | None = None) -> None:
    protocol_dir = trial.paths.trial_dir / "protocol"
    protocol_dir.mkdir(parents=True, exist_ok=True)
    ledger = protocol_dir / "transition-ledger.jsonl"
    previous = "0" * 64
    if ledger.exists():
        lines = [line for line in ledger.read_text().splitlines() if line.strip()]
        if lines:
            previous = json.loads(lines[-1])["entry_hash"]
    body = {
        "sequence": sum(1 for _ in ledger.open()) + 1 if ledger.exists() else 1,
        "event": event,
        "previous_hash": previous,
        "details": details or {},
        "patch_version": PATCH_VERSION,
    }
    body["entry_hash"] = _sha256_bytes(_canonical(body))
    with ledger.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(body, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _store_object(sealed_root: Path, candidate: Path, inventory: dict, *, kind: str) -> Path:
    objects = sealed_root / "objects"
    objects.mkdir(parents=True, exist_ok=True, mode=0o700)
    digest = inventory["digest"]
    final = objects / f"{kind}-{digest}"
    if final.exists():
        stored = json.loads((final / "inventory.json").read_text())
        if stored["digest"] != digest:
            raise ProtocolInvalidError("existing sealed object digest mismatch")
        return final

    temp = objects / f".tmp-{uuid.uuid4().hex}"
    temp.mkdir(mode=0o700)
    shutil.move(str(candidate), str(temp / "candidate"))
    (temp / "inventory.json").write_text(json.dumps(inventory, indent=2, sort_keys=True) + "\n")
    _fsync_tree(temp)
    os.rename(temp, final)
    parent_fd = os.open(objects, os.O_RDONLY)
    try:
        os.fsync(parent_fd)
    finally:
        os.close(parent_fd)
    for path in sorted(final.rglob("*"), reverse=True):
        os.chmod(path, 0o500 if path.is_dir() else 0o400)
    os.chmod(final, 0o500)
    return final


async def _container_id(trial: MultiStepTrial) -> str:
    result = await trial.agent_environment._run_docker_compose_command(["ps", "-q", "main"])
    ids = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
    if len(ids) != 1:
        raise ProtocolInvalidError(f"expected one main container, observed {len(ids)}")
    return ids[0]


async def _assert_agent_isolation(trial: MultiStepTrial, step_name: str) -> None:
    container_id = await _container_id(trial)
    inspect = json.loads(_run(["docker", "inspect", container_id]).stdout)[0]
    sealed_root = str(Path(os.environ["LB6_SEALED_ROOT"]).resolve())
    private_root = str(Path(os.environ["LB6_PRIVATE_VERIFIER_ROOT"]).resolve())
    inventory = []
    for mount in inspect.get("Mounts", []):
        source = str(mount.get("Source", ""))
        destination = str(mount.get("Destination", ""))
        if source.startswith(sealed_root) or source.startswith(private_root):
            raise ProtocolInvalidError("private or sealed host path mounted into agent environment")
        if destination in {"/candidate", "/treatment", "/verifier", "/tests"}:
            raise ProtocolInvalidError(f"forbidden evaluator mount visible to agent: {destination}")
        inventory.append(
            {
                "destination": destination,
                "rw": bool(mount.get("RW")),
                "source_hash": _sha256_bytes(source.encode()),
                "type": mount.get("Type"),
            }
        )
    probe = await trial.agent_environment.exec(
        "if [ -e /tests ]; then echo present; find /tests -mindepth 1 -maxdepth 2 -print -quit; else echo absent; fi"
    )
    if (probe.stdout or "").strip() != "absent":
        raise ProtocolInvalidError("agent-visible /tests path exists")
    record = {
        "step": step_name,
        "tests_path": "absent",
        "mount_inventory": sorted(inventory, key=lambda item: item["destination"]),
        "sealed_store_mounted": False,
        "private_verifier_mounted": False,
    }
    trial._lb6_baseline_processes = await _process_inventory(trial)
    protocol_dir = trial.paths.trial_dir / "protocol"
    protocol_dir.mkdir(parents=True, exist_ok=True)
    (protocol_dir / f"agent-isolation-{step_name}.json").write_text(
        json.dumps(record, indent=2, sort_keys=True) + "\n"
    )
    _append_ledger(trial, "agent_isolation_passed", {"step": step_name, "tests_path": "absent"})


async def _process_inventory(trial: MultiStepTrial) -> list[dict]:
    result = await trial.agent_environment.exec("ps -eo pid=,ppid=,comm=,args=")
    if result.return_code != 0:
        raise ProtocolInvalidError("unable to inventory agent cgroup processes")
    processes = []
    for raw in (result.stdout or "").splitlines():
        parts = raw.strip().split(None, 3)
        if len(parts) < 4:
            continue
        pid, ppid, command, args = parts
        if command == "ps" and args.startswith("ps -eo"):
            continue
        processes.append({"pid": int(pid), "ppid": int(ppid), "command": command, "args": args})
    return processes


def _process_signature(process: dict) -> tuple[str, str]:
    return process["command"], process["args"]


async def _cleanup_to_baseline(trial: MultiStepTrial) -> list[dict]:
    baseline = list(getattr(trial, "_lb6_baseline_processes", []))
    if not baseline:
        raise ProtocolInvalidError("baseline process inventory missing")
    expected: dict[tuple[str, str], int] = {}
    for process in baseline:
        signature = _process_signature(process)
        expected[signature] = expected.get(signature, 0) + 1

    current = await _process_inventory(trial)
    seen: dict[tuple[str, str], int] = {}
    extras = []
    for process in current:
        signature = _process_signature(process)
        count = seen.get(signature, 0)
        seen[signature] = count + 1
        if count >= expected.get(signature, 0):
            extras.append(process)

    if extras:
        pids = sorted({process["pid"] for process in extras}, reverse=True)
        await trial.agent_environment.exec(
            "kill -TERM " + " ".join(str(pid) for pid in pids) + " 2>/dev/null || true"
        )
        await asyncio.sleep(0.5)
        remaining = {process["pid"] for process in await _process_inventory(trial)}
        stubborn = [pid for pid in pids if pid in remaining]
        if stubborn:
            await trial.agent_environment.exec(
                "kill -KILL " + " ".join(str(pid) for pid in stubborn) + " 2>/dev/null || true"
            )
            await asyncio.sleep(0.2)

    final = await _process_inventory(trial)
    final_counts: dict[tuple[str, str], int] = {}
    for process in final:
        signature = _process_signature(process)
        final_counts[signature] = final_counts.get(signature, 0) + 1
    if final_counts != expected:
        raise ProtocolInvalidError("agent descendant cleanup did not restore baseline process set")
    return final


async def _seal_workspace(trial: MultiStepTrial, phase: str, *, keep_environment: bool) -> dict:
    sealed_root = Path(os.environ["LB6_SEALED_ROOT"]).resolve()
    sealed_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(sealed_root, 0o700)

    container_id = await _container_id(trial)
    quiesced_processes = await _cleanup_to_baseline(trial)
    process_table = _canonical(
        [{"command": item["command"], "args": item["args"]} for item in quiesced_processes]
    )

    await trial.agent_environment._run_docker_compose_command(["pause", "main"])
    paused = True
    try:
        with tempfile.TemporaryDirectory(prefix="lb6-capture-") as temp_name:
            temp = Path(temp_name)
            raw_a = temp / "raw-a"
            raw_b = temp / "raw-b"
            raw_a.mkdir()
            raw_b.mkdir()
            _run(["docker", "cp", f"{container_id}:/app/.", str(raw_a)])
            _run(["docker", "cp", f"{container_id}:/app/.", str(raw_b)])

            norm_a = temp / "norm-a"
            norm_b = temp / "norm-b"
            inv_a = _normalise(raw_a, norm_a)
            inv_b = _normalise(raw_b, norm_b)
            if inv_a != inv_b:
                raise ProtocolInvalidError("double capture was not byte-identical")

            audit_a = temp / "audit-a"
            audit_b = temp / "audit-b"
            audit_inv_a = _normalise(raw_a, audit_a, treatment_only=True)
            audit_inv_b = _normalise(raw_b, audit_b, treatment_only=True)
            if audit_inv_a != audit_inv_b:
                raise ProtocolInvalidError("treatment audit double capture mismatch")

            candidate_object = _store_object(sealed_root, norm_a, inv_a, kind="candidate")
            audit_object = _store_object(sealed_root, audit_a, audit_inv_a, kind="treatment")
            record = {
                "phase": phase,
                "candidate_digest": inv_a["digest"],
                "candidate_inventory_hash": _sha256_bytes(_canonical(inv_a)),
                "treatment_digest": audit_inv_a["digest"],
                "treatment_inventory_hash": _sha256_bytes(_canonical(audit_inv_a)),
                "double_capture_identical": True,
                "container_process_table_hash": _sha256_bytes(process_table),
                "descendant_cleanup": "baseline_restored",
                "normalizer": PATCH_VERSION,
                "candidate_object": candidate_object,
                "treatment_object": audit_object,
            }
    except Exception:
        await trial._stop_agent_environment()
        paused = False
        raise
    finally:
        if keep_environment and paused:
            await trial.agent_environment._run_docker_compose_command(["unpause", "main"])

    public_record = {key: value for key, value in record.items() if not key.endswith("_object")}
    protocol_dir = trial.paths.trial_dir / "protocol"
    protocol_dir.mkdir(parents=True, exist_ok=True)
    (protocol_dir / f"{phase}-seal.json").write_text(
        json.dumps(public_record, indent=2, sort_keys=True) + "\n"
    )
    _append_ledger(trial, f"{phase}_sealed", public_record)
    return record


async def _restart_from_seal(trial: MultiStepTrial, seal: dict) -> None:
    await trial._stop_agent_environment()
    _append_ledger(trial, "shaping_environment_removed")
    await trial.agent_environment.start(force_build=False)
    trial._is_agent_environment_stopped = False
    await trial.agent_environment.run_healthcheck()
    await trial._upload_injected_skills()
    with trial.agent_environment.with_default_user(trial.task.config.agent.user):
        await trial._setup_agent()
        await trial.agent_environment.upload_dir(
            source_dir=seal["candidate_object"] / "candidate",
            target_dir="/app",
        )
        treatment_dir = seal["treatment_object"] / "candidate"
        if any(treatment_dir.iterdir()):
            await trial.agent_environment.upload_dir(source_dir=treatment_dir, target_dir="/app")
        # Sealed objects are deliberately mode 0400/0500. The post-seal workspace
        # is a disposable copy and must be writable by the next agent phase.
        chmod_result = await trial.agent_environment.exec("chmod -R u+rwX /app", user="root")
        if chmod_result.return_code != 0:
            raise ProtocolInvalidError("post-seal workspace permission restore failed")
    _append_ledger(
        trial,
        "post_seal_environment_restored",
        {"candidate_digest": seal["candidate_digest"], "treatment_digest": seal["treatment_digest"]},
    )


def _docker_image_id(image: str) -> str:
    result = _run(["docker", "image", "inspect", image, "--format", "{{.Id}}"])
    value = result.stdout.strip()
    if not value.startswith("sha256:"):
        raise ProtocolInvalidError("verifier image is not content-addressed")
    return value


def _run_verifier_once(
    trial: MultiStepTrial,
    seal: dict,
    private_dir: Path,
    output_dir: Path,
    *,
    suffix: str,
) -> dict:
    output_dir = output_dir.resolve()
    image = os.environ["LB6_VERIFIER_IMAGE"]
    image_id = _docker_image_id(image)
    output_dir.mkdir(parents=True, exist_ok=False)
    os.chmod(output_dir, 0o777)
    name = f"lb6-verify-{trial.id.hex[:12]}-{suffix}"
    candidate = seal["candidate_object"] / "candidate"
    treatment = seal["treatment_object"] / "candidate"
    command = ["node", "/verifier/grade.mjs"]
    env_values = ["LB6_CANDIDATE_DIGEST=" + seal["candidate_digest"]]
    create = [
        "docker", "create", "--name", name,
        "--network", "none", "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
        "--workdir", "/candidate",
        "--mount", f"type=bind,src={candidate},dst=/candidate,readonly",
        "--mount", f"type=bind,src={treatment},dst=/treatment,readonly",
        "--mount", f"type=bind,src={private_dir},dst=/verifier,readonly",
        "--mount", f"type=bind,src={output_dir},dst=/output",
        "--env", env_values[0],
        image_id,
        *command,
    ]
    try:
        _run(create)
        inspect = json.loads(_run(["docker", "inspect", name]).stdout)[0]
        mounts = sorted(
            ({
                "destination": item["Destination"],
                "rw": item["RW"],
                "type": item["Type"],
            }
            for item in inspect["Mounts"]),
            key=lambda item: item["destination"],
        )
        expected_destinations = {"/candidate", "/treatment", "/verifier", "/output"}
        if {item["destination"] for item in mounts} != expected_destinations:
            raise ProtocolInvalidError("verifier mount inventory mismatch")
        if any(item["rw"] for item in mounts if item["destination"] != "/output"):
            raise ProtocolInvalidError("read-only verifier input mounted writable")
        if inspect["HostConfig"]["NetworkMode"] != "none" or not inspect["HostConfig"]["ReadonlyRootfs"]:
            raise ProtocolInvalidError("verifier network/rootfs isolation mismatch")
        result = _run(["docker", "start", "--attach", name], timeout=120, check=False)
        if result.returncode != 0:
            raise ProtocolInvalidError(f"isolated verifier exited {result.returncode}")
    finally:
        _run(["docker", "rm", "-f", name], check=False)

    reward_path = output_dir / "reward.json"
    report_path = output_dir / "behavior_report.json"
    if not reward_path.exists() or not report_path.exists():
        raise ProtocolInvalidError("isolated verifier did not emit required outputs")
    reward = json.loads(reward_path.read_text())
    if not isinstance(reward.get("reward"), (int, float)):
        raise ProtocolInvalidError("isolated verifier reward schema invalid")
    evidence = {
        "verifier_image_digest": image_id,
        "candidate_digest": seal["candidate_digest"],
        "treatment_digest": seal["treatment_digest"],
        "fixture_digest": _hash_directory(private_dir),
        "environment_allowlist_hash": _sha256_bytes(_canonical(env_values)),
        "command_hash": _sha256_bytes(_canonical(command)),
        "mount_inventory": mounts,
        "network_mode": "none",
        "read_only_rootfs": True,
        "reward_hash": _sha256_file(reward_path),
        "behavior_report_hash": _sha256_file(report_path),
    }
    (output_dir / "verifier-abi.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")
    return {"reward": reward, "evidence": evidence}


def _hash_directory(root: Path) -> str:
    entries = []
    for path in sorted(root.rglob("*")):
        if path.is_file():
            entries.append({"path": path.relative_to(root).as_posix(), "sha256": _sha256_file(path)})
    return _sha256_bytes(_canonical(entries))


async def _isolated_verify(trial: MultiStepTrial, seal: dict, step_name: str) -> VerifierResult:
    private_root = Path(os.environ["LB6_PRIVATE_VERIFIER_ROOT"]).resolve()
    arm = str(trial.task.config.metadata.get("arm"))
    task_id = str(trial.task.config.metadata.get("task_id"))
    private_dir = private_root / task_id / arm
    if not private_dir.is_dir():
        raise ProtocolInvalidError("private verifier fixture missing")

    await trial._stop_agent_environment()
    _append_ledger(trial, "agent_environment_removed")
    output_base = trial.paths.verifier_dir
    if output_base.exists():
        shutil.rmtree(output_base)
    first = _run_verifier_once(trial, seal, private_dir, output_base, suffix="a")

    # Mutation-independence/determinism calibration: mutate an unrelated former-live
    # decoy, then rerun only from the sealed digest and require identical outputs.
    decoy = trial.paths.trial_dir / "protocol" / "former-live-decoy"
    decoy.mkdir(parents=True, exist_ok=True)
    (decoy / "mutation.txt").write_text(uuid.uuid4().hex)
    second_dir = trial.paths.trial_dir / "protocol" / "verifier-replay"
    if second_dir.exists():
        shutil.rmtree(second_dir)
    second = _run_verifier_once(trial, seal, private_dir, second_dir, suffix="b")
    if first["evidence"]["reward_hash"] != second["evidence"]["reward_hash"]:
        raise ProtocolInvalidError("verifier reward changed after post-seal mutation")
    if first["evidence"]["behavior_report_hash"] != second["evidence"]["behavior_report_hash"]:
        raise ProtocolInvalidError("verifier report changed after post-seal mutation")
    _append_ledger(
        trial,
        "scoring_complete",
        {
            "candidate_digest": seal["candidate_digest"],
            "reward_hash": first["evidence"]["reward_hash"],
            "deterministic_replay": True,
        },
    )
    return VerifierResult(rewards=first["reward"])


def _load_skill_bundle_manifest() -> dict:
    manifest_path = os.environ.get("LB6_SKILL_BUNDLE_MANIFEST")
    if not manifest_path:
        raise ProtocolInvalidError("LB6_SKILL_BUNDLE_MANIFEST is required")
    path = Path(manifest_path)
    if not path.is_file():
        raise ProtocolInvalidError("skill bundle manifest missing")
    return json.loads(path.read_text())


async def _resolve_container_skills_path(trial: MultiStepTrial) -> str:
    result = await trial.agent_environment.exec('printf %s "$HOME/.cursor/skills"')
    if result.return_code != 0:
        raise ProtocolInvalidError("unable to resolve container Cursor skill root")
    container_path = (result.stdout or "").strip()
    if not container_path:
        raise ProtocolInvalidError("container Cursor skill root is empty")
    return container_path


async def _inspect_container_skill_registration(
    trial: MultiStepTrial,
    manifest: dict,
    *,
    arm: str,
) -> dict:
    container_path = await _resolve_container_skills_path(trial)
    container_id = await _container_id(trial)

    with tempfile.TemporaryDirectory(prefix="lb6-skill-capture-") as temp_name:
        capture_root = Path(temp_name) / "skills"
        capture_root.mkdir()
        cp_source = f"{container_id}:{container_path}/."
        cp = subprocess.run(
            ["docker", "cp", cp_source, str(capture_root)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if cp.returncode != 0:
            stderr = (cp.stderr or cp.stdout or "").strip()
            if "Could not find the file" in stderr or "No such file" in stderr:
                if arm == "lamina":
                    raise ProtocolInvalidError("container skill root missing for lamina arm")
                return {
                    "container_path": container_path,
                    "container_file_count": 0,
                    "container_aggregate_digest": EMPTY_INVENTORY_DIGEST,
                    "lamina_skill_absent": True,
                }
            raise ProtocolInvalidError(f"container skill capture failed: {stderr[-500:]}")

        details = verify_container_skill_capture(capture_root, manifest, require_present=(arm == "lamina"))
        details["container_path"] = container_path
        return details


def _assert_host_pre_model_skill_gate(
    trial: MultiStepTrial,
    *,
    arm: str,
    manifest: dict,
    lock: dict,
) -> tuple[list[str], list[dict]]:
    staged_root = Path(os.environ.get("LB6_SKILL_BUNDLE_ROOT", "")).resolve()
    skill_sources = extract_lock_skill_sources(lock)
    skill_locks = parse_agent_skill_locks(lock)
    expected_digests = manifest.get("harbor_skill_digests") or {}
    lock_check = validate_agent_skill_locks(
        skill_locks,
        arm=arm,
        expected_skill_names=list(manifest.get("skills") or []),
        expected_digests=expected_digests if arm == "lamina" else None,
    )
    if not lock_check["passed"]:
        raise ProtocolInvalidError(f"pre_model_skill_gate: {lock_check['reason']}")

    if arm == "lamina":
        for skill_name in manifest.get("skills") or []:
            skill_md = staged_root / skill_name / "SKILL.md"
            if not skill_md.is_file():
                raise ProtocolInvalidError(f"pre_model_skill_gate: staged skill missing {skill_name}")
        if not manifest.get("aggregate_digest"):
            raise ProtocolInvalidError("pre_model_skill_gate: skill bundle digest missing")

    return skill_sources, skill_locks


async def _assert_pre_model_skill_gate(trial: MultiStepTrial, *, step_name: str) -> None:
    arm = str(trial.task.config.metadata.get("arm"))
    task_id = str(trial.task.config.metadata.get("task_id"))
    manifest = _load_skill_bundle_manifest()
    lock_path = trial.paths.trial_dir / "lock.json"
    if not lock_path.exists():
        lock_path = trial.paths.job_dir / "lock.json"
    lock = json.loads(lock_path.read_text()) if lock_path.exists() else {}

    try:
        skill_sources, skill_locks = _assert_host_pre_model_skill_gate(
            trial,
            arm=arm,
            manifest=manifest,
            lock=lock,
        )
        container_details = await _inspect_container_skill_registration(trial, manifest, arm=arm)
    except SkillGateError as exc:
        raise ProtocolInvalidError(str(exc)) from exc

    _append_ledger(
        trial,
        "pre_model_skill_gate",
        {
            "arm": arm,
            "task_id": task_id,
            "phase": step_name,
            "source_skill_commit": manifest.get("source_skill_commit") or manifest.get("pinned_commit"),
            "bundle_commit": manifest.get("pinned_commit"),
            "bundle_digest": manifest.get("aggregate_digest"),
            "skill_sources": skill_sources,
            "skill_locks": [
                {"name": entry["name"], "source": entry["source"], "digest": entry["digest"]}
                for entry in skill_locks
                if entry.get("digest")
            ],
            "container_path": container_details["container_path"],
            "container_file_count": container_details["container_file_count"],
            "container_aggregate_digest": container_details["container_aggregate_digest"],
            "lamina_skill_absent": container_details["lamina_skill_absent"],
            "passed": True,
        },
    )


async def _patched_run_step(self, step, step_result, *, index: int, total: int) -> None:
    arm = str(self.task.config.metadata.get("arm"))
    shaping_step = "implement" if arm == "lamina" else "shape_build"
    final_step = "fix" if arm == "lamina" else "verify_fix"
    self._create_step_dirs(step)
    await self._prepare_step(step, step_result)
    if step_result.exception_info is not None:
        self._archive_step_outputs(step)
        return

    try:
        await _assert_agent_isolation(self, step.name)
    except Exception as exc:
        step_result.exception_info = ExceptionInfo.from_exception(
            exc if isinstance(exc, ProtocolInvalidError) else ProtocolInvalidError(str(exc))
        )
        _append_ledger(self, "protocol_invalid", {"step": step.name, "error_type": type(exc).__name__})
        await self._stop_agent_environment()
        self._archive_step_outputs(step)
        return

    if index == 0:
        try:
            await _assert_pre_model_skill_gate(self, step_name=step.name)
        except Exception as exc:
            step_result.exception_info = ExceptionInfo.from_exception(
                exc if isinstance(exc, ProtocolInvalidError) else ProtocolInvalidError(str(exc))
            )
            _append_ledger(self, "protocol_invalid", {"step": step.name, "error_type": type(exc).__name__})
            await self._stop_agent_environment()
            self._archive_step_outputs(step)
            return

    await self._run_step_agent(step, step_result)
    await self._upload_agent_logs()
    if step_result.exception_info is not None:
        self._archive_step_outputs(step)
        return

    step_result.verifier = TimingInfo(started_at=self._now())
    try:
        if step.name == shaping_step:
            shaping_seal = await _seal_workspace(self, "shaping", keep_environment=False)
            await _restart_from_seal(self, shaping_seal)
            abi_dir = self.task.paths.steps_dir / final_step / "workdir" / ".lb6-abi"
            if not abi_dir.is_dir():
                raise ProtocolInvalidError("public ABI injection payload missing")
            _append_ledger(
                self,
                "abi_ready",
                {"abi_hash": _hash_directory(abi_dir), "injected_by": "harbor-step-workdir"},
            )
            step_result.verifier_result = VerifierResult(rewards={"reward": 1, "protocol": 1})
        elif step.name == final_step:
            seal = await _seal_workspace(self, "final", keep_environment=False)
            step_result.verifier_result = await _isolated_verify(self, seal, step.name)
        else:
            step_result.verifier_result = VerifierResult(rewards={"reward": 1, "protocol": 1})
    except Exception as exc:
        step_result.exception_info = ExceptionInfo.from_exception(
            exc if isinstance(exc, ProtocolInvalidError) else ProtocolInvalidError(str(exc))
        )
        try:
            _append_ledger(self, "protocol_invalid", {"step": step.name, "error_type": type(exc).__name__})
        finally:
            await self._stop_agent_environment()
        step_result.verifier_result = None
    finally:
        step_result.verifier.finished_at = self._now()

    self._archive_step_outputs(step)


def install() -> None:
    if getattr(MultiStepTrial, "_lb6_host_seal_installed", False):
        return
    original = MultiStepTrial._run_step
    from harbor.agents.installed.cursor_cli import CursorCli

    async def install_prebuilt_cursor(self, environment):
        expected_version = "2026.07.20-8cc9c0b"
        expected_hash = "eed61c5224668c9236334c4c68936a16aecc37374b592f59e31eb50433817831"
        command = (
            "set -euo pipefail; export PATH=\"$HOME/.local/bin:$PATH\"; "
            "test \"$(cursor-agent --version)\" = \"" + expected_version + "\"; "
            "test \"$(sha256sum \"$(readlink -f \"$HOME/.local/bin/cursor-agent\")\" | cut -d' ' -f1)\" = \""
            + expected_hash + "\""
        )
        result = await environment.exec(command=command)
        if result.return_code != 0:
            raise ProtocolInvalidError("prebuilt Cursor CLI version/hash validation failed")
        skills_command = self._build_register_skills_command()
        if skills_command:
            await self.exec_as_agent(environment, command=skills_command)

    CursorCli.install = install_prebuilt_cursor

    async def dispatch(self, step, step_result, *, index: int, total: int):
        required = bool(self.task.config.metadata.get("host_sealed_supervisor_required", False))
        if not required:
            return await original(self, step, step_result, index=index, total=total)
        return await _patched_run_step(self, step, step_result, index=index, total=total)

    MultiStepTrial._run_step = dispatch
    MultiStepTrial._lb6_host_seal_installed = True
