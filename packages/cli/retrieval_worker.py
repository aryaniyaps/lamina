"""Offline hybrid-retrieval worker for Lamina.

The worker reads source and workflow input, computes checksum-managed Jina
embeddings, and sends generation batches to graphd. It never opens Ladybug.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
from typing import Any, Iterable

import numpy as np


DIMENSIONS = 768
MAX_TOKENS = 1024
MAX_CHUNK_CHARACTERS = 12_000
MAX_CHUNK_LINES = 240
TEXT_EXTENSIONS = {
    ".c", ".cc", ".cpp", ".css", ".go", ".h", ".hpp", ".html", ".java",
    ".js", ".jsx", ".json", ".kt", ".md", ".mdx", ".mjs", ".php", ".py",
    ".rb", ".rs", ".scss", ".sql", ".swift", ".ts", ".tsx", ".vue", ".yaml",
    ".yml",
}
SYMBOL_PATTERNS = {
    ".py": re.compile(r"^(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)", re.M),
    ".go": re.compile(r"^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)", re.M),
    ".rs": re.compile(r"^(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|trait|impl)\s+([A-Za-z_][A-Za-z0-9_]*)", re.M),
    ".java": re.compile(r"^(?:\s*(?:public|private|protected|static|final|abstract)\s+)*(?:class|interface|enum|record|[\w<>\[\]]+\s+)([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|\{|extends|implements)", re.M),
}
JAVASCRIPT_SYMBOL = re.compile(
    r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?"
    r"(?:(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)|"
    r"(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>)",
    re.M,
)


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def stable_id(prefix: str, value: Any) -> str:
    return f"{prefix}_{sha256(canonical(value))[:32]}"


def normalize(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm else vector


class Embedder:
    def __init__(self) -> None:
        self.test_only = os.environ.get("LAMINA_TEST_RETRIEVAL_EMBEDDER") == "deterministic"
        self.lexical_only = os.environ.get("LAMINA_RETRIEVAL_LEXICAL_ONLY") == "1"
        if self.lexical_only:
            self.session = None
            self.tokenizer = None
            return
        if self.test_only:
            self.session = None
            self.tokenizer = None
            return
        import onnxruntime as ort
        from tokenizers import Tokenizer

        model = pathlib.Path(os.environ["LAMINA_RETRIEVAL_MODEL_PATH"])
        expected = os.environ["LAMINA_RETRIEVAL_MODEL_DIGEST"]
        actual = sha256(model.read_bytes())
        if actual != expected:
            raise RuntimeError(
                f"LAMINA_RETRIEVAL_INTEGRITY: model digest {actual} does not match {expected}"
            )
        tokenizer = pathlib.Path(os.environ["LAMINA_RETRIEVAL_TOKENIZER_PATH"])
        if not tokenizer.is_file():
            raise RuntimeError("LAMINA_RETRIEVAL_INTEGRITY: tokenizer is missing")
        self.tokenizer = Tokenizer.from_file(str(tokenizer))
        self.session = ort.InferenceSession(
            str(model),
            providers=["CPUExecutionProvider"],
        )

    def encode(self, texts: list[str]) -> list[list[float]]:
        if self.lexical_only:
            return [[0.0] * DIMENSIONS for _ in texts]
        if self.test_only:
            return [self._deterministic(text) for text in texts]
        encoded = self.tokenizer.encode_batch(texts)
        ids = [item.ids[:MAX_TOKENS] for item in encoded]
        masks = [item.attention_mask[:MAX_TOKENS] for item in encoded]
        maximum = max(len(item) for item in ids)
        input_ids = np.zeros((len(ids), maximum), dtype=np.int64)
        attention_mask = np.zeros((len(ids), maximum), dtype=np.int64)
        for index, (token_ids, mask) in enumerate(zip(ids, masks)):
            input_ids[index, : len(token_ids)] = token_ids
            attention_mask[index, : len(mask)] = mask
        hidden = self.session.run(
            ["last_hidden_state"],
            {"input_ids": input_ids, "attention_mask": attention_mask},
        )[0]
        expanded = attention_mask[..., None].astype(np.float32)
        pooled = (hidden * expanded).sum(axis=1) / np.maximum(expanded.sum(axis=1), 1e-9)
        return [normalize(row).astype(np.float32).tolist() for row in pooled]

    @staticmethod
    def _deterministic(text: str) -> list[float]:
        vector = np.zeros(DIMENSIONS, dtype=np.float32)
        expanded = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text).lower()
        for token in re.findall(r"[a-z][a-z0-9]{1,}", expanded):
            digest = hashlib.sha256(token.encode()).digest()
            for offset in range(0, 16, 2):
                index = int.from_bytes(digest[offset : offset + 2], "big") % DIMENSIONS
                vector[index] += 1.0 if digest[offset] & 1 else -1.0
        return normalize(vector).tolist()


def graphd_exchange(request: bytes) -> bytes:
    endpoint = os.environ["LAMINA_GRAPHD_ENDPOINT"]
    if os.name == "nt":
        import pywintypes
        import win32file
        import win32pipe

        win32pipe.WaitNamedPipe(endpoint, 10_000)
        handle = win32file.CreateFile(
            endpoint,
            win32file.GENERIC_READ | win32file.GENERIC_WRITE,
            0,
            None,
            win32file.OPEN_EXISTING,
            0,
            None,
        )
        try:
            win32file.WriteFile(handle, request)
            payload = b""
            while b"\n" not in payload:
                _, chunk = win32file.ReadFile(handle, 65_536)
                if not chunk:
                    raise RuntimeError("graphd closed before acknowledging retrieval batch")
                payload += chunk
            return payload
        finally:
            handle.Close()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.connect(endpoint)
        client.sendall(request)
        payload = b""
        while b"\n" not in payload:
            chunk = client.recv(65_536)
            if not chunk:
                raise RuntimeError("graphd closed before acknowledging retrieval batch")
            payload += chunk
        return payload


def graphd_request(method: str, params: dict[str, Any]) -> dict[str, Any]:
    payload = graphd_exchange(
        (
            json.dumps(
                {
                    "id": "retrieval-worker",
                    "method": method,
                    "params": params,
                    "cwd": os.environ["LAMINA_SOURCE_ROOT"],
                    "auth": os.environ["LAMINA_GRAPHD_TOKEN"],
                }
            )
            + "\n"
        ).encode()
    )
    response = json.loads(payload.split(b"\n", 1)[0])
    if not response.get("ok"):
        error = response.get("error", {})
        raise RuntimeError(
            f"{error.get('code', 'LAMINA_INTERNAL')}: "
            f"{error.get('message', 'graphd rejected retrieval batch')} "
            f"{json.dumps(error.get('details', {}), sort_keys=True)}"
        )
    return response["result"]


def tracked_files(root: pathlib.Path) -> list[pathlib.Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    return [
        root / value.decode(errors="surrogateescape")
        for value in result.stdout.split(b"\0")
        if value
    ]


def symbol_boundaries(suffix: str, text: str) -> list[tuple[int, str]]:
    pattern = JAVASCRIPT_SYMBOL if suffix in {".js", ".jsx", ".mjs", ".ts", ".tsx"} else SYMBOL_PATTERNS.get(suffix)
    if not pattern:
        return []
    rows = []
    for match in pattern.finditer(text):
        symbol = next((value for value in match.groups() if value), None)
        if symbol:
            rows.append((text.count("\n", 0, match.start()) + 1, symbol))
    return rows


def split_region(
    relative: str,
    symbol: str,
    lines: list[str],
    start_line: int,
) -> Iterable[dict[str, Any]]:
    cursor = 0
    while cursor < len(lines):
        part = []
        characters = 0
        while cursor < len(lines) and len(part) < MAX_CHUNK_LINES:
            candidate = lines[cursor]
            if part and characters + len(candidate) > MAX_CHUNK_CHARACTERS:
                break
            part.append(candidate)
            characters += len(candidate)
            cursor += 1
        if not part:
            part = [lines[cursor][:MAX_CHUNK_CHARACTERS]]
            cursor += 1
        first = start_line + cursor - len(part)
        last = first + len(part) - 1
        text = (
            f"file: {relative}\n"
            f"symbol: {symbol}\n"
            f"lines: {first}-{last}\n\n"
            + "".join(part)
        )
        yield {
            "logical_key": f"source:{relative}:{symbol}:{first}:{last}",
            "kind": "source",
            "workflow_id": "",
            "aliases": [],
            "text": text,
            "path": relative,
            "symbol": symbol,
            "start_line": first,
            "end_line": last,
            "metadata": {"facets": {"path": [relative], "symbol": [symbol]}},
        }


def source_documents(root: pathlib.Path) -> list[dict[str, Any]]:
    output = []
    for file in tracked_files(root):
        relative = file.relative_to(root).as_posix()
        if file.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        try:
            if not file.is_file() or file.stat().st_size > 2 * 1024 * 1024:
                continue
            text = file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        lines = text.splitlines(keepends=True)
        boundaries = symbol_boundaries(file.suffix.lower(), text)
        if not boundaries:
            output.extend(split_region(relative, "<module>", lines, 1))
            continue
        if boundaries[0][0] > 1:
            output.extend(split_region(relative, "<module>", lines[: boundaries[0][0] - 1], 1))
        for index, (start, symbol) in enumerate(boundaries):
            end = boundaries[index + 1][0] - 1 if index + 1 < len(boundaries) else len(lines)
            output.extend(split_region(relative, symbol, lines[start - 1 : end], start))
    return output


def prepare_documents(
    snapshot: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str], set[str]]:
    root = pathlib.Path(os.environ["LAMINA_SOURCE_ROOT"]).resolve()
    documents = [*snapshot.get("workflows", []), *source_documents(root)]
    previous = snapshot.get("previous", {})
    upserts = []
    member_ids = []
    embedder = Embedder()
    pending = []
    for document in documents:
        content_hash = sha256(document["text"].encode())
        existing = previous.get(document["logical_key"])
        if existing and existing.get("content_hash") == content_hash:
            member_ids.append(existing["id"])
            continue
        item = {
            **document,
            "identity": snapshot["identity"],
            "content_hash": content_hash,
        }
        item["id"] = stable_id(
            "retrieval_doc",
            {
                "identity": snapshot["identity"],
                "logical_key": item["logical_key"],
                "content_hash": content_hash,
                "model_digest": snapshot["model_digest"],
            },
        )
        pending.append(item)
        member_ids.append(item["id"])
    for offset in range(0, len(pending), 16):
        batch = pending[offset : offset + 16]
        vectors = embedder.encode([item["text"] for item in batch])
        for item, embedding in zip(batch, vectors):
            item["embedding"] = embedding
            upserts.append(item)
    return upserts, member_ids, {document["logical_key"] for document in documents}


def index_digest(items: list[dict[str, str]]) -> str:
    canonical_items = sorted(
        (
            {
                "id": item["id"],
                "logical_key": item["logical_key"],
                "content_hash": item["content_hash"],
            }
            for item in items
        ),
        key=lambda item: item["logical_key"],
    )
    return sha256(canonical(canonical_items))


def index_command(input_path: pathlib.Path) -> dict[str, Any]:
    snapshot = json.loads(input_path.read_text())
    upserts, members, logical_keys = prepare_documents(snapshot)
    previous = snapshot.get("previous", {})
    deletes = sorted(set(previous) - logical_keys)
    current_by_id = {item["id"]: item for item in upserts}
    for logical_key, item in previous.items():
        if item["id"] in members and item["id"] not in current_by_id:
            current_by_id[item["id"]] = {
                "id": item["id"],
                "logical_key": logical_key,
                "content_hash": item["content_hash"],
            }
    generation = stable_id(
        "retrieval_generation",
        {
            "identity": snapshot["identity"],
            "graph_version": snapshot["graph_version"],
            "source_revision": snapshot["source_revision"],
            "model_digest": snapshot["model_digest"],
            "schema_version": snapshot["schema_version"],
        },
    )
    manifest = {
        key: snapshot[key]
        for key in (
            "identity", "graph_version", "source_revision", "repository_revision",
            "branch", "worktree", "model_digest", "schema_version",
        )
    }
    manifest.update(
        {
            "generation": generation,
            "expected_count": len(members),
            "index_digest": index_digest([current_by_id[item] for item in members]),
        }
    )
    for offset in range(0, max(len(upserts), len(members), 1), 100):
        graphd_request(
            "retrieval.apply",
            {
                "identity": snapshot["identity"],
                "generation": generation,
                "manifest": manifest,
                "reset": offset == 0,
                "upserts": upserts[offset : offset + 100],
                "members": members[offset : offset + 100],
                "deletes": deletes[offset : offset + 100],
                "complete": False,
            },
        )
    result = graphd_request(
        "retrieval.apply",
        {
            "identity": snapshot["identity"],
            "generation": generation,
            "manifest": manifest,
            "upserts": [],
            "members": [],
            "complete": True,
        },
    )
    return {"ok": True, **result}


def embedded_asset_root() -> pathlib.Path:
    base = pathlib.Path(getattr(sys, "_MEIPASS", pathlib.Path(__file__).parent))
    return base / "retrieval-assets"


def extract_assets(destination: pathlib.Path) -> dict[str, Any]:
    source = embedded_asset_root()
    manifest = json.loads((source / "asset-manifest.json").read_text())
    destination.mkdir(parents=True, exist_ok=True)
    for item in manifest["files"]:
        source_file = source / item["embedded_path"]
        target = destination / item["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_file, target)
        if sha256(target.read_bytes()) != item["sha256"]:
            raise RuntimeError(f"LAMINA_RETRIEVAL_INTEGRITY: failed to extract {item['path']}")
    shutil.copyfile(source / "asset-manifest.json", destination / "asset-manifest.json")
    return {"ok": True, "destination": str(destination), "files": len(manifest["files"])}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cocoindex-worker retrieval")
    subparsers = parser.add_subparsers(dest="command", required=True)
    index_parser = subparsers.add_parser("index")
    index_parser.add_argument("--input", required=True, type=pathlib.Path)
    subparsers.add_parser("embed")
    extract_parser = subparsers.add_parser("extract-assets")
    extract_parser.add_argument("--destination", required=True, type=pathlib.Path)
    subparsers.add_parser("serve")
    args = parser.parse_args(argv)
    if args.command == "index":
        result = index_command(args.input)
    elif args.command == "embed":
        request = json.loads(sys.stdin.read())
        result = {"embeddings": Embedder().encode(request["texts"])}
    elif args.command == "extract-assets":
        result = extract_assets(args.destination)
    else:
        embedder = Embedder()
        for line in sys.stdin:
            try:
                request = json.loads(line)
                response = {"embeddings": embedder.encode(request["texts"])}
            except Exception as error:  # keep the warm worker alive for the next request
                response = {"error": str(error)}
            sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
            sys.stdout.flush()
        return 0
    sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
