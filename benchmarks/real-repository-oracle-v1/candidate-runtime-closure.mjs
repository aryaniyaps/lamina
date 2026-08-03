import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertTrustedBinaryIdentity,
  trustedBinaryIdentity,
  trustedReadOpenFlags,
  trustedRootHostBinary,
} from '../../scripts/safe-runner/infrastructure.mjs';

export const CANDIDATE_RUNTIME_SNAPSHOT_SCHEMA =
  'lamina.real-repository-oracle-candidate-runtime-snapshot/v1';
const MAX_RUNTIME_FILES = 128;
const MAX_RUNTIME_BYTES = 512 * 1024 * 1024;
const ISSUED_SNAPSHOTS = new WeakSet();

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => sha256(Buffer.from(JSON.stringify(canonical(value))));

function exactPrivateDirectory(candidate, label) {
  const absolute = path.resolve(String(candidate || ''));
  const stat = fs.lstatSync(absolute, { bigint: true });
  if (!path.isAbsolute(String(candidate || '')) || absolute !== candidate
    || fs.realpathSync.native(absolute) !== absolute || !stat.isDirectory()
    || stat.isSymbolicLink() || (process.platform !== 'win32'
      && (stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o077n) !== 0n))) {
    throw new Error(`${label} must be an exact private physical directory`);
  }
  return {
    path: absolute,
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: Number(stat.uid),
    nlink: String(stat.nlink),
    mode: Number(stat.mode & 0o7777n),
  };
}

function runtimeLibraryIdentity(candidate) {
  const absolute = fs.realpathSync.native(path.resolve(candidate));
  const stat = fs.lstatSync(absolute, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0n
    || (stat.mode & 0o022n) !== 0n || fs.realpathSync.native(absolute) !== absolute
    || stat.size < 1n || stat.size > BigInt(MAX_RUNTIME_BYTES)) {
    throw new Error(`candidate runtime library lacks root-owned physical authority: ${absolute}`);
  }
  const bytes = fs.readFileSync(absolute);
  return {
    path: absolute, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
    mode: Number(stat.mode & 0o7777n), size: String(stat.size), digest: sha256(bytes),
    library_file: true,
  };
}

function assertRuntimeSourceIdentity(expected) {
  if (expected.library_file !== true) return assertTrustedBinaryIdentity(expected);
  const actual = runtimeLibraryIdentity(expected.path);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('candidate runtime library identity changed');
  }
  return actual;
}

function copyExactFile(source, destination, expectedIdentity) {
  assertRuntimeSourceIdentity(expectedIdentity);
  const input = fs.openSync(source, trustedReadOpenFlags());
  const output = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL, 0o500);
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (true) {
      const count = fs.readSync(input, buffer, 0, buffer.length, offset);
      if (count === 0) break;
      fs.writeSync(output, buffer, 0, count, offset);
      offset += count;
      if (offset > MAX_RUNTIME_BYTES) throw new Error('candidate runtime snapshot exceeds byte bound');
    }
    fs.fsyncSync(output);
  } finally {
    fs.closeSync(output);
    fs.closeSync(input);
  }
  assertRuntimeSourceIdentity(expectedIdentity);
  const bytes = fs.readFileSync(destination);
  if (sha256(bytes) !== expectedIdentity.digest || String(bytes.length) !== expectedIdentity.size) {
    throw new Error('candidate runtime snapshot copy differs from trusted source identity');
  }
  fs.chmodSync(destination, 0o500);
}

function loadedClosure(nodeIdentity) {
  const ldd = trustedRootHostBinary('ldd');
  assertTrustedBinaryIdentity(ldd);
  const result = spawnSync(ldd.path, [nodeIdentity.path], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' },
  });
  if (result.error || result.status !== 0 || result.signal || result.stderr.trim()) {
    throw new Error(`candidate runtime ELF closure discovery failed: ${String(result.stderr || '')}`);
  }
  assertTrustedBinaryIdentity(ldd);
  const resolved = new Map([[nodeIdentity.path, { source: nodeIdentity.path, target: 'node' }]]);
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/=>\s+(\/[^\s]+)\s+\(0x[0-9a-f]+\)/i)
      || line.match(/^\s*(\/[^\s]+)\s+\(0x[0-9a-f]+\)/i);
    if (match) {
      const source = fs.realpathSync.native(match[1]);
      if (!resolved.has(source)) resolved.set(source, {
        source, target: path.basename(match[1]),
      });
    }
    else if (/=>\s+not found/.test(line)) throw new Error('candidate runtime ELF dependency is missing');
  }
  const entries = [...resolved.values()].sort((left, right) => left.source.localeCompare(right.source));
  if (entries.length < 3 || entries.length > MAX_RUNTIME_FILES) {
    throw new Error('candidate runtime ELF closure has invalid bounded cardinality');
  }
  const loader = entries.find((item) =>
    /(?:^|\/)(?:ld-linux[^/]*|ld-musl[^/]*)\.so(?:\.[0-9]+)*$/.test(item.source));
  if (!loader) throw new Error('candidate runtime ELF loader was not resolved explicitly');
  loader.target = 'loader';
  return { entries, loader: loader.source, ldd };
}

const RUNNING_IMAGE_STABLE_FIELDS = Object.freeze([
  'dev', 'ino', 'uid', 'gid', 'mode', 'size', 'nlink', 'mtimeNs', 'ctimeNs',
]);

function runningImageStableFields(stat) {
  return Object.fromEntries(RUNNING_IMAGE_STABLE_FIELDS.map((field) => [field, String(stat[field])]));
}

function sameRunningImage(left, right) {
  return JSON.stringify(runningImageStableFields(left))
    === JSON.stringify(runningImageStableFields(right));
}

function hashOpenDescriptor(descriptor, size) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let offset = 0;
  while (offset < size) {
    const count = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (count === 0) throw new Error('running process image ended while hashing');
    hash.update(buffer.subarray(0, count));
    offset += count;
  }
  if (fs.readSync(descriptor, buffer, 0, 1, offset) !== 0) {
    throw new Error('running process image exceeded its attested size');
  }
  return hash.digest('hex');
}

function assertRunningProcessImageIdentity(expected) {
  if (expected?.authority !== 'running-process-image-fd' || expected.pid !== process.pid) {
    throw new Error('candidate runtime running-process authority changed');
  }
  const descriptor = fs.openSync('/proc/self/exe', fs.constants.O_RDONLY);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.statSync('/proc/self/exe', { bigint: true });
    const size = Number(before.size);
    if (!before.isFile() || !sameRunningImage(before, linked)
      || !Number.isSafeInteger(size) || size < 1 || size > MAX_RUNTIME_BYTES
      || JSON.stringify(runningImageStableFields(before)) !== JSON.stringify(expected.stable)
      || hashOpenDescriptor(descriptor, size) !== expected.digest) {
      throw new Error('candidate runtime running-process image identity changed');
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameRunningImage(before, after)) {
      throw new Error('candidate runtime running-process image changed while hashing');
    }
    return expected;
  } finally {
    fs.closeSync(descriptor);
  }
}

function sealRunningProcessImage(destination) {
  const input = fs.openSync('/proc/self/exe', fs.constants.O_RDONLY);
  const output = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL, 0o500);
  try {
    const before = fs.fstatSync(input, { bigint: true });
    const linked = fs.statSync('/proc/self/exe', { bigint: true });
    const size = Number(before.size);
    if (!before.isFile() || !sameRunningImage(before, linked)
      || !Number.isSafeInteger(size) || size < 1 || size > MAX_RUNTIME_BYTES) {
      throw new Error('candidate runtime cannot attest the running process image');
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < size) {
      const count = fs.readSync(input, buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (count === 0) throw new Error('running process image ended while sealing');
      hash.update(buffer.subarray(0, count));
      fs.writeSync(output, buffer, 0, count, offset);
      offset += count;
    }
    if (fs.readSync(input, buffer, 0, 1, offset) !== 0) {
      throw new Error('running process image exceeded its attested size');
    }
    fs.fsyncSync(output);
    const after = fs.fstatSync(input, { bigint: true });
    const linkedAfter = fs.statSync('/proc/self/exe', { bigint: true });
    if (!sameRunningImage(before, after) || !sameRunningImage(after, linkedAfter)) {
      throw new Error('running process image changed while sealing');
    }
    const identity = Object.freeze({
      authority: 'running-process-image-fd',
      pid: process.pid,
      stable: Object.freeze(runningImageStableFields(after)),
      digest: hash.digest('hex'),
    });
    return identity;
  } finally {
    fs.closeSync(output);
    fs.closeSync(input);
  }
}

function snapshotRecords(root) {
  const names = fs.readdirSync(root).sort();
  const records = [];
  for (const name of names) {
    const candidate = path.join(root, name);
    const stat = fs.lstatSync(candidate, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
      || fs.realpathSync.native(candidate) !== candidate) {
      throw new Error('candidate runtime snapshot contains a non-physical file');
    }
    const bytes = fs.readFileSync(candidate);
    records.push({
      name,
      dev: String(stat.dev),
      ino: String(stat.ino),
      uid: Number(stat.uid),
      nlink: String(stat.nlink),
      mode: Number(stat.mode & 0o7777n),
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  if (records.length > MAX_RUNTIME_FILES
    || records.reduce((total, item) => total + item.bytes, 0) > MAX_RUNTIME_BYTES) {
    throw new Error('candidate runtime snapshot exceeds bounded closure limits');
  }
  return records;
}

export function buildCandidateRuntimeSnapshot({ snapshot_root: snapshotRoot } = {}) {
  if (process.platform !== 'linux') {
    throw new Error('candidate runtime snapshot construction requires Linux ELF authority');
  }
  const parent = exactPrivateDirectory(path.dirname(snapshotRoot), 'candidate runtime parent');
  if (fs.existsSync(snapshotRoot) || path.dirname(snapshotRoot) !== parent.path) {
    throw new Error('candidate runtime snapshot destination must be absent under its exact parent');
  }
  fs.mkdirSync(snapshotRoot, { mode: 0o700 });
  const runningNodeIdentity = sealRunningProcessImage(path.join(snapshotRoot, 'node'));
  const nodeIdentity = trustedBinaryIdentity(path.join(snapshotRoot, 'node'), {
    expectedDigest: runningNodeIdentity.digest,
  });
  const closure = loadedClosure(nodeIdentity);
  const usedNames = new Set(['node']);
  const files = [{
    role: 'node', source: '/proc/self/exe', target: 'node', sandbox_target: '/runtime/node',
    identity: nodeIdentity,
  }];
  for (const entry of closure.entries) {
    const { source } = entry;
    if (source === nodeIdentity.path) continue;
    const role = source === closure.loader ? 'loader' : 'library';
    const identity = role === 'library' ? runtimeLibraryIdentity(source)
      : trustedBinaryIdentity(source);
    const base = role === 'library' ? entry.target : 'loader';
    if (usedNames.has(base)) throw new Error(`candidate runtime library basename collided: ${base}`);
    usedNames.add(base);
    copyExactFile(source, path.join(snapshotRoot, base), identity);
    files.push({ role, source, target: base, sandbox_target: `/runtime/${base}`, identity });
  }
  const rootIdentity = exactPrivateDirectory(snapshotRoot, 'candidate runtime snapshot');
  const records = snapshotRecords(snapshotRoot);
  const snapshot = Object.freeze({
    schema: CANDIDATE_RUNTIME_SNAPSHOT_SCHEMA,
    root: snapshotRoot,
    root_identity: Object.freeze(rootIdentity),
    node: '/runtime/node',
    loader: '/runtime/loader',
    library_path: '/runtime',
    files: Object.freeze(files.map((item) => Object.freeze({
      ...item, identity: Object.freeze({ ...item.identity }),
    }))),
    mounts: Object.freeze(files.map((item) => Object.freeze({
      snapshot_name: item.target,
      destination: item.sandbox_target,
    }))),
    records: Object.freeze(records.map((item) => Object.freeze(item))),
    closure_sha256: digest(records),
    builder_identities: Object.freeze({
      node: runningNodeIdentity, ldd: Object.freeze({ ...closure.ldd }),
    }),
  });
  ISSUED_SNAPSHOTS.add(snapshot);
  return snapshot;
}

export function verifyCandidateRuntimeSnapshot(snapshot) {
  if (!snapshot || !ISSUED_SNAPSHOTS.has(snapshot)) {
    throw new Error('candidate runtime snapshot was not issued by this host process');
  }
  const root = exactPrivateDirectory(snapshot.root, 'candidate runtime snapshot');
  if (JSON.stringify(root) !== JSON.stringify(snapshot.root_identity)) {
    throw new Error('candidate runtime snapshot root identity changed');
  }
  assertRunningProcessImageIdentity(snapshot.builder_identities.node);
  assertTrustedBinaryIdentity(snapshot.builder_identities.ldd);
  for (const file of snapshot.files) assertRuntimeSourceIdentity(file.identity);
  const records = snapshotRecords(snapshot.root);
  if (digest(records) !== snapshot.closure_sha256
    || JSON.stringify(records) !== JSON.stringify(snapshot.records)) {
    throw new Error('candidate runtime snapshot content changed');
  }
  return snapshot;
}
