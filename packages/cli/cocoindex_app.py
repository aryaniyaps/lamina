"""Incremental source observations for Lamina's graphd.

CocoIndex owns only memoization and target-state tracking. This process never
opens Ladybug; its custom target sends idempotent observation batches to graphd.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import socket
from dataclasses import dataclass
from typing import Collection, NamedTuple, Sequence

import cocoindex as coco
from cocoindex.connectorkits.fingerprint import fingerprint_bytes
from cocoindex.connectors import localfs
from cocoindex.resources.file import FileLike, PatternFilePathMatcher


SOURCE_ROOT = pathlib.Path(os.environ.get("LAMINA_SOURCE_ROOT", pathlib.Path.cwd())).resolve()
GRAPHD_ENDPOINT = os.environ["LAMINA_GRAPHD_ENDPOINT"]
GRAPHD_TOKEN = os.environ["LAMINA_GRAPHD_TOKEN"]
PRODUCT = os.environ.get("LAMINA_PRODUCT", SOURCE_ROOT.name)
SOURCE_REVISION = os.environ["LAMINA_SOURCE_REVISION"]
IGNORE_DIGEST = os.environ["LAMINA_IGNORE_DIGEST"]
EXTRACTOR_DIGEST = os.environ.get("LAMINA_EXTRACTOR_DIGEST", "lamina.source-file.v2")
GENERATION = os.environ["LAMINA_OBSERVATION_GENERATION"]
OBSERVATION_LIVE = os.environ.get("LAMINA_OBSERVATION_LIVE") == "1"

SNAPSHOT = {
    "product": PRODUCT,
    "source_revision": SOURCE_REVISION,
    "source_root": str(SOURCE_ROOT),
    "ignore_policy_digest": IGNORE_DIGEST,
    "extractor_set_digest": EXTRACTOR_DIGEST,
}


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _digest(prefix: str, value: object) -> str:
    return f"{prefix}_{hashlib.sha256(_canonical(value)).hexdigest()[:32]}"


def _unique(values: list[str], limit: int = 100) -> list[str]:
    return sorted({value.strip() for value in values if value and value.strip()})[:limit]


def _brownfield_signals(relative_path: str, content: bytes) -> dict[str, object]:
    if b"\x00" in content[:4096]:
        return {
            "categories": [],
            "unsupported": ["binary_content"],
        }
    text = content.decode("utf-8", errors="replace")
    truncated = len(text) > 1_000_000
    if truncated:
        text = text[:1_000_000]
    suffix = pathlib.PurePosixPath(relative_path).suffix.lower()
    basename = pathlib.PurePosixPath(relative_path).name.lower()
    signals: dict[str, list[str]] = {
        "entry_points": [],
        "commands": [],
        "routes": [],
        "handlers": [],
        "schemas": [],
        "entities": [],
        "state_transitions": [],
        "permissions": [],
        "events": [],
        "tests": [],
        "documentation": [],
        "personas": [],
        "feature_flags": [],
        "dependencies": [],
    }

    if basename in {
        "main.js", "main.mjs", "main.ts", "main.py", "index.js", "index.mjs",
        "index.ts", "app.js", "app.ts", "app.py", "server.js", "server.ts",
        "cli.py", "manage.py",
    } or text.startswith("#!"):
        signals["entry_points"].append(relative_path)
    if "/routes/" in f"/{relative_path}" or basename.startswith("route."):
        signals["routes"].append(relative_path)
    if suffix in {".md", ".mdx", ".rst", ".txt"}:
        signals["documentation"].append(relative_path)
    if "persona" in basename:
        signals["personas"].append(relative_path)
    if re.search(r"(?:^|[/_.-])(?:test|tests|spec|specs)(?:[/_.-]|$)", relative_path, re.I):
        signals["tests"].append(relative_path)

    if basename == "package.json":
        try:
            package = json.loads(text)
            signals["commands"].extend(
                f"npm:{name}" for name in (package.get("scripts") or {}).keys()
            )
            binary = package.get("bin") or {}
            if isinstance(binary, str):
                signals["entry_points"].append(f"bin:{binary}")
            elif isinstance(binary, dict):
                signals["entry_points"].extend(
                    f"bin:{name}:{target}" for name, target in binary.items()
                )
            for field in ("dependencies", "devDependencies", "peerDependencies"):
                signals["dependencies"].extend(
                    f"{field}:{name}" for name in (package.get(field) or {}).keys()
                )
        except (TypeError, ValueError):
            pass

    signals["routes"].extend(
        match.group(2)[1:-1]
        for match in re.finditer(
            r"\b(?:app|router|server)\s*\.\s*(get|post|put|patch|delete|use)\s*"
            r"\(\s*([\"'][^\"']+[\"'])",
            text,
        )
    )
    signals["handlers"].extend(
        match.group(1)
        for match in re.finditer(
            r"\b(?:function|class|const|let|var|def)\s+"
            r"([A-Za-z_][A-Za-z0-9_]*(?:handler|controller|resolver|listener|callback))\b",
            text,
            re.I,
        )
    )
    declared_types = [
        match.group(2)
        for match in re.finditer(
            r"\b(interface|type|class|model|schema|enum)\s+([A-Z][A-Za-z0-9_]*)\b",
            text,
        )
    ]
    signals["schemas"].extend(declared_types)
    signals["entities"].extend(declared_types)
    signals["events"].extend(
        match.group(2)
        for match in re.finditer(
            r"\b(emit|on|once|addEventListener|dispatchEvent)\s*\(\s*[\"']([^\"']+)[\"']",
            text,
        )
    )
    signals["state_transitions"].extend(
        f"{match.group(1)}:{match.group(2)}"
        for match in re.finditer(
            r"\b(state|status|phase)\s*(?:=|:)\s*[\"']?([A-Za-z][A-Za-z0-9_-]*)",
            text,
            re.I,
        )
    )
    signals["permissions"].extend(
        match.group(0)
        for match in re.finditer(
            r"\b(?:authorize|authorization|permission|permissions|role|roles|"
            r"canAccess|isAdmin|requireAuth|authGuard)\b",
            text,
            re.I,
        )
    )
    signals["feature_flags"].extend(
        match.group(0)
        for match in re.finditer(
            r"\b(?:FEATURE_[A-Z0-9_]+|featureFlag|feature_flag|flagEnabled|toggle)\b",
            text,
        )
    )
    signals["dependencies"].extend(
        match.group(2)
        for match in re.finditer(
            r"\b(import\s+.*?\s+from|require|from)\s*\(?\s*[\"']([^\"']+)[\"']",
            text,
        )
    )
    if re.search(r"\b(describe|it|test)\s*\(", text) or re.search(r"\b(assert|expect)\s*[\.(]", text):
        signals["tests"].append(relative_path)

    normalized = {key: _unique(values) for key, values in signals.items()}
    categories = sorted(key for key, values in normalized.items() if values)
    return {
        "categories": categories,
        "signals": {key: values for key, values in normalized.items() if values},
        "unsupported": ["static_scan_truncated"] if truncated else [],
    }


@dataclass(frozen=True)
class ObservationSpec:
    envelope: dict[str, object]
    snapshot: dict[str, str]
    generation: str


@dataclass(frozen=True, slots=True)
class ObservationTracking:
    fingerprint: bytes
    snapshot: dict[str, str]
    generation: str


class ObservationAction(NamedTuple):
    observation_id: str
    envelope: dict[str, object] | None
    snapshot: dict[str, str]
    generation: str


def _graphd_request(method: str, params: dict[str, object]) -> dict[str, object]:
    request = (
        json.dumps(
            {
                "id": "cocoindex",
                "method": method,
                "params": params,
                "cwd": str(SOURCE_ROOT),
                "auth": GRAPHD_TOKEN,
            }
        )
        + "\n"
    ).encode()
    payload = _graphd_exchange(request)
    response = json.loads(payload.split(b"\n", 1)[0])
    if not response.get("ok"):
        error = response.get("error", {})
        raise RuntimeError(f"{error.get('code', 'LAMINA_INTERNAL')}: {error.get('message', 'graphd rejected batch')}")
    return response["result"]


def _graphd_exchange(request: bytes) -> bytes:
    if os.name == "nt":
        import pywintypes
        import win32file
        import win32pipe

        try:
            win32pipe.WaitNamedPipe(GRAPHD_ENDPOINT, 10_000)
            handle = win32file.CreateFile(
                GRAPHD_ENDPOINT,
                win32file.GENERIC_READ | win32file.GENERIC_WRITE,
                0,
                None,
                win32file.OPEN_EXISTING,
                0,
                None,
            )
        except pywintypes.error as error:
            raise RuntimeError(f"unable to connect to graphd named pipe: {error}") from error
        try:
            win32file.WriteFile(handle, request)
            payload = b""
            while b"\n" not in payload:
                _, chunk = win32file.ReadFile(handle, 65_536)
                if not chunk:
                    raise RuntimeError(
                        "graphd closed the named pipe without acknowledging the observation batch"
                    )
                payload += chunk
            return payload
        finally:
            handle.Close()

    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.connect(GRAPHD_ENDPOINT)
        client.sendall(request)
        payload = b""
        while b"\n" not in payload:
            chunk = client.recv(65_536)
            if not chunk:
                raise RuntimeError(
                    "graphd closed the socket without acknowledging the observation batch"
                )
            payload += chunk
        return payload


def _apply_actions(
    context_provider: coco.ContextProvider,
    actions: Sequence[ObservationAction],
) -> None:
    del context_provider
    grouped: dict[tuple[str, str], list[ObservationAction]] = {}
    for action in actions:
        snapshot_key = json.dumps(action.snapshot, sort_keys=True)
        grouped.setdefault((snapshot_key, action.generation), []).append(action)
    for (snapshot_key, generation), batch in grouped.items():
        _graphd_request(
            "observation.apply",
            {
                "snapshot": json.loads(snapshot_key),
                "generation": generation,
                "upserts": [item.envelope for item in batch if item.envelope is not None],
                "deletes": [item.observation_id for item in batch if item.envelope is None],
            },
        )
        if os.environ.get("LAMINA_TEST_OBSERVATION_CRASH_AFTER_COMMIT") == "1":
            os._exit(91)


_observation_sink = coco.TargetActionSink[ObservationAction, None].from_fn(_apply_actions)


class ObservationHandler(coco.TargetHandler[ObservationSpec, ObservationTracking]):
    def reconcile(
        self,
        key: coco.StableKey,
        desired_target_state: ObservationSpec | coco.NonExistenceType,
        prev_possible_records: Collection[ObservationTracking],
        prev_may_be_missing: bool,
        /,
    ) -> coco.TargetReconcileOutput[ObservationAction, ObservationTracking] | None:
        observation_id = str(key)
        if coco.is_non_existence(desired_target_state):
            if not prev_possible_records and not prev_may_be_missing:
                return None
            previous = next(iter(prev_possible_records), None)
            snapshot = previous.snapshot if previous else SNAPSHOT
            generation = previous.generation if previous else GENERATION
            return coco.TargetReconcileOutput(
                action=ObservationAction(observation_id, None, snapshot, generation),
                sink=_observation_sink,
                tracking_record=coco.NON_EXISTENCE,
            )
        target_fp = fingerprint_bytes(_canonical(desired_target_state.envelope))
        if not prev_may_be_missing and prev_possible_records and all(
            record.fingerprint == target_fp
            and record.generation == desired_target_state.generation
            for record in prev_possible_records
        ):
            return None
        return coco.TargetReconcileOutput(
            action=ObservationAction(
                observation_id,
                desired_target_state.envelope,
                desired_target_state.snapshot,
                desired_target_state.generation,
            ),
            sink=_observation_sink,
            tracking_record=ObservationTracking(
                fingerprint=target_fp,
                snapshot=desired_target_state.snapshot,
                generation=desired_target_state.generation,
            ),
        )


_provider = coco.register_root_target_states_provider(
    "dev.lamina/graphd/observation/v1",
    ObservationHandler(),
)


@coco.fn(memo=True)
async def observe_file(file: FileLike, generation: str, source_revision: str) -> None:
    del source_revision
    content = await file.read()
    observed_path = pathlib.Path(str(file.file_path.path))
    try:
        relative_path = str(
            observed_path.relative_to(SOURCE_ROOT) if observed_path.is_absolute() else observed_path
        )
    except ValueError:
        relative_path = observed_path.name
    relative_path = relative_path.replace(os.sep, "/").removeprefix("./")
    content_hash = hashlib.sha256(content).hexdigest()
    extractor = {"id": "lamina.source-file", "version": "2"}
    envelope: dict[str, object] = {
        "source_snapshot": SNAPSHOT,
        "source_key": relative_path,
        "content_hash": content_hash,
        "path": relative_path,
        "extractor": extractor,
        "payload": {
            "media_type": "text" if b"\x00" not in content[:4096] else "binary",
            "byte_length": len(content),
            "brownfield": _brownfield_signals(relative_path, content),
        },
    }
    envelope["id"] = _digest(
        "observation",
        {
            "snapshot": envelope["source_snapshot"],
            "source_key": envelope["source_key"],
            "content_hash": envelope["content_hash"],
            "extractor": envelope["extractor"],
            "payload": envelope["payload"],
        },
    )
    coco.declare_target_state(
        _provider.target_state(
            envelope["id"],
            ObservationSpec(envelope=envelope, snapshot=SNAPSHOT, generation=generation),
        )
    )


@coco.fn
async def app_main(sourcedir: pathlib.Path) -> None:
    files = localfs.walk_dir(
        sourcedir,
        recursive=True,
        path_matcher=PatternFilePathMatcher(
            included_patterns=["**/*"],
            excluded_patterns=[
                "**/.git/**",
                "**/.lamina/runs/**",
                "**/.lamina/runtime/**",
                "**/.lamina/runtime-cli/**",
                "**/.agents/skills/**",
                "**/.codex/skills/**",
                "**/.claude/skills/**",
                "**/.opencode/skills/**",
                "**/node_modules/**",
                "**/.venv*/**",
                "**/__pycache__/**",
                "**/.next/**",
                "**/dist/**",
                "**/build/**",
                "**/coverage/**",
                "**/benchmarks/results/**",
                "**/evals/fixtures/.vendor-tmp*/**",
            ],
        ),
        live=OBSERVATION_LIVE,
    )
    # Generation is an explicit memoized-function argument so a rebuild forces
    # every unchanged source item through target reconciliation.
    await coco.mount_each(observe_file, files.items(), GENERATION, SOURCE_REVISION)


app = coco.App(coco.AppConfig(name="LaminaSourceObservationsV1"), app_main, sourcedir=SOURCE_ROOT)
