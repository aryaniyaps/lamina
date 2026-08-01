import fs from 'node:fs';
import path from 'node:path';

export function lstatPresence(candidate) {
  try { return { exists: true, stat: fs.lstatSync(candidate, { bigint: true }) }; }
  catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, stat: null };
    throw error;
  }
}

function parentIdentity(candidate) {
  const parentPath = path.dirname(candidate);
  const stat = fs.lstatSync(parentPath, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || fs.realpathSync.native(parentPath) !== parentPath
    || (typeof process.getuid === 'function' && Number(stat.uid) !== process.getuid())) return null;
  return { path: parentPath, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid) };
}

function sameParent(candidate, expected) {
  try {
    const actual = parentIdentity(candidate);
    return actual && actual.path === expected?.path && actual.dev === expected.dev
      && actual.ino === expected.ino && actual.uid === expected.uid;
  } catch { return false; }
}

function objectIdentity(candidate, type) {
  const { exists, stat } = lstatPresence(candidate);
  const typeMatches = type === 'socket' ? stat?.isSocket() : stat?.isFile();
  if (!exists || !typeMatches || stat.isSymbolicLink()
    || (typeof process.getuid === 'function' && Number(stat.uid) !== process.getuid())) return null;
  return {
    dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
    mode: Number(stat.mode & 0o777n), size: String(stat.size), type,
  };
}

function sameObject(actual, expected) {
  return actual && ['dev', 'ino', 'uid', 'mode', 'size', 'type']
    .every((field) => actual[field] === expected?.[field]);
}

function readLockProof(record, identity) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(record.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (String(opened.dev) !== identity.dev || String(opened.ino) !== identity.ino
      || Number(opened.uid) !== identity.uid || !opened.isFile()) return null;
    const text = fs.readFileSync(descriptor, 'utf8').trim();
    try {
      const parsed = JSON.parse(text);
      return { pid: Number(parsed?.pid), reservation: parsed?.safe_runner_reservation || null };
    } catch { return { pid: Number(text), reservation: null }; }
  } catch { return null; }
  finally { if (descriptor !== null) fs.closeSync(descriptor); }
}

export function reserveManagedObjects(socket, lock, reservationToken) {
  if (typeof reservationToken !== 'string' || !/^[a-f0-9]{64}$/.test(reservationToken)) return null;
  const records = [
    { path: path.resolve(socket), type: 'socket' },
    { path: path.resolve(lock), type: 'lock' },
  ];
  for (const record of records) {
    record.parent_identity = parentIdentity(record.path);
    if (!record.parent_identity || lstatPresence(record.path).exists) return null;
    record.state = 'reserved';
    record.reservation_token = reservationToken;
    record.uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  }
  return records;
}

export function bindManagedObjects(records, expectedPids) {
  if (!Array.isArray(expectedPids) || expectedPids.length < 1
    || expectedPids.some((pid) => !Number.isSafeInteger(pid) || pid <= 1)) return null;
  const uniquePids = [...new Set(expectedPids)];
  const bound = [];
  for (const record of records || []) {
    if (record?.state !== 'reserved' || !sameParent(record.path, record.parent_identity)
      || lstatPresence(record.path).exists) return null;
    bound.push({ ...record, state: 'bound', expected_pids: uniquePids });
  }
  return bound;
}

export function authorizeManagedObjects(records) {
  const authorized = [];
  for (const record of records || []) {
    if (record?.state !== 'bound' || !sameParent(record.path, record.parent_identity)
      || lstatPresence(record.path).exists) return null;
    authorized.push({ ...record, state: 'authorized' });
  }
  return authorized;
}

export function sealManagedObjects(records) {
  const sealed = [];
  for (const record of records || []) {
    if (record?.state !== 'authorized' || !sameParent(record.path, record.parent_identity)) return null;
    const identity = objectIdentity(record.path, record.type);
    if (!identity) return null;
    if (record.type === 'lock') {
      const proof = readLockProof(record, identity);
      if (!Number.isSafeInteger(proof?.pid) || !record.expected_pids.includes(proof.pid)
        || proof.reservation !== record.reservation_token) return null;
      identity.lock_pid = proof.pid;
    }
    sealed.push({ ...record, state: 'sealed', object_identity: identity });
  }
  return sealed;
}

export function removeManagedObjects(records, { beforeUnlink = null } = {}) {
  const transitional = new Map();
  const bound = (records || []).filter((record) =>
    ['bound', 'authorized'].includes(record?.state));
  if (bound.length) {
    const lock = bound.find((record) => record.type === 'lock');
    const socket = bound.find((record) => record.type === 'socket');
    if (lock && socket && lock.reservation_token === socket.reservation_token
      && sameParent(lock.path, lock.parent_identity) && sameParent(socket.path, socket.parent_identity)) {
      const lockIdentity = objectIdentity(lock.path, 'lock');
      const socketIdentity = objectIdentity(socket.path, 'socket');
      const proof = lockIdentity ? readLockProof(lock, lockIdentity) : null;
      if (Number.isSafeInteger(proof?.pid)
        && lock.expected_pids.includes(proof.pid)
        && proof.reservation === lock.reservation_token) {
        transitional.set(lock.path, lockIdentity);
        if (socketIdentity) transitional.set(socket.path, socketIdentity);
      }
    }
  }
  const remaining = [];
  for (const record of records || []) {
    let presence;
    try { presence = lstatPresence(record.path); } catch { remaining.push(record.path); continue; }
    if (!presence.exists) continue;
    const expectedObject = record.state === 'sealed'
      ? record.object_identity : transitional.get(record.path);
    if (!expectedObject || !sameParent(record.path, record.parent_identity)
      || !sameObject(objectIdentity(record.path, record.type), expectedObject)) {
      remaining.push(record.path);
      continue;
    }
    try { beforeUnlink?.(record); } catch { remaining.push(record.path); continue; }
    // Recheck parent and object identity immediately before the name-based
    // unlink. Any same-UID replacement or dangling symlink is foreign and must
    // survive as explicit incomplete cleanup evidence.
    if (!sameParent(record.path, record.parent_identity)
      || !sameObject(objectIdentity(record.path, record.type), expectedObject)) {
      remaining.push(record.path);
      continue;
    }
    try { fs.unlinkSync(record.path); } catch { remaining.push(record.path); continue; }
    if (lstatPresence(record.path).exists) remaining.push(record.path);
  }
  return [...new Set(remaining)];
}
