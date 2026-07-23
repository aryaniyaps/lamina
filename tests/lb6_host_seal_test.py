import json
import os
import tempfile
import uuid
from pathlib import Path

from lb6_harbor_patch import (
    ProtocolInvalidError,
    _normalise,
    _run_verifier_once,
    _store_object,
)


class FakePaths:
    def __init__(self, root: Path):
        self.trial_dir = root


class FakeTrial:
    def __init__(self, root: Path):
        self.id = uuid.uuid4()
        self.paths = FakePaths(root)


with tempfile.TemporaryDirectory(prefix="lb6-host-seal-test-") as temp_name:
    root = Path(temp_name)
    raw = root / "raw"
    raw.mkdir()
    (raw / "app.mjs").write_text("export const ok = true;\n")
    (raw / "index.html").write_text("<main>ok</main>\n")
    (raw / ".env").write_text("CURSOR_API_KEY=must-not-seal\n")
    (raw / ".lamina").mkdir()
    (raw / ".lamina" / "business-context.md").write_text("context\n")

    norm_a = root / "norm-a"
    norm_b = root / "norm-b"
    inv_a = _normalise(raw, norm_a)
    inv_b = _normalise(raw, norm_b)
    assert inv_a == inv_b
    assert not (norm_a / ".env").exists()
    assert not (norm_a / ".lamina").exists()

    audit_a = root / "audit-a"
    audit_inv = _normalise(raw, audit_a, treatment_only=True)
    sealed = root / "sealed"
    candidate_object = _store_object(sealed, norm_a, inv_a, kind="candidate")
    treatment_object = _store_object(sealed, audit_a, audit_inv, kind="treatment")

    private = root / "private"
    private.mkdir()
    (private / "grade.mjs").write_text(
        "import fs from 'node:fs';"
        "const candidate=process.env.LB6_CANDIDATE_DIGEST;"
        "fs.writeFileSync('/output/reward.json', JSON.stringify({reward:1,behavior:1,import_ok:1})+'\\n');"
        "fs.writeFileSync('/output/behavior_report.json', JSON.stringify({candidate,reward:1})+'\\n');"
    )
    seal = {
        "candidate_object": candidate_object,
        "treatment_object": treatment_object,
        "candidate_digest": inv_a["digest"],
        "treatment_digest": audit_inv["digest"],
    }
    trial = FakeTrial(root / "trial")
    trial.paths.trial_dir.mkdir()
    first = _run_verifier_once(trial, seal, private, root / "out-a", suffix="a")
    (raw / "app.mjs").write_text("export const ok = false;\n")
    second = _run_verifier_once(trial, seal, private, root / "out-b", suffix="b")
    assert first["reward"] == second["reward"]
    assert first["evidence"]["reward_hash"] == second["evidence"]["reward_hash"]
    assert first["evidence"]["network_mode"] == "none"
    assert first["evidence"]["read_only_rootfs"] is True
    assert {m["destination"] for m in first["evidence"]["mount_inventory"]} == {
        "/candidate", "/treatment", "/verifier", "/output"
    }

    bad = root / "bad"
    bad.mkdir()
    (bad / "escape").symlink_to("/etc/passwd")
    try:
        _normalise(bad, root / "bad-normalised")
        raise AssertionError("symlink should fail closed")
    except ProtocolInvalidError:
        pass

print("lb6 host seal tests passed")
