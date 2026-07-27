"""Incremental source observations for Lamina's graphd.

CocoIndex owns only memoization and target-state tracking. This process never
opens Ladybug; its custom target sends idempotent observation batches to graphd.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
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
EXTRACTOR_DIGEST = os.environ.get("LAMINA_EXTRACTOR_DIGEST", "lamina.source-file.v1")
GENERATION = os.environ["LAMINA_OBSERVATION_GENERATION"]

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
async def observe_file(file: FileLike, generation: str) -> None:
    content = await file.read()
    relative_path = str(file.file_path.path)
    content_hash = hashlib.sha256(content).hexdigest()
    extractor = {"id": "lamina.source-file", "version": "1"}
    envelope: dict[str, object] = {
        "source_snapshot": SNAPSHOT,
        "source_key": relative_path,
        "content_hash": content_hash,
        "path": relative_path,
        "extractor": extractor,
        "payload": {
            "media_type": "text" if b"\x00" not in content[:4096] else "binary",
            "byte_length": len(content),
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
                "**/.lamina/**",
                "**/node_modules/**",
                "**/.venv/**",
                "**/__pycache__/**",
            ],
        ),
        live=True,
    )
    # Generation is an explicit memoized-function argument so a rebuild forces
    # every unchanged source item through target reconciliation.
    await coco.mount_each(observe_file, files.items(), GENERATION)


app = coco.App(coco.AppConfig(name="LaminaSourceObservationsV1"), app_main, sourcedir=SOURCE_ROOT)
