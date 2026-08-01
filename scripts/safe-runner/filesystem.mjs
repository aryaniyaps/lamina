import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { identityAlive, processIdentity } from './processes.mjs';

export function boundedDirectorySize(
  root,
  stopAfterBytes = Number.MAX_SAFE_INTEGER,
  stopAfterEntries = Number.MAX_SAFE_INTEGER,
) {
  let bytes = 0;
  let entries = 0;
  let symlinks = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let children = [];
    try { children = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      entries += 1;
      const absolute = path.join(current, child.name);
      if (child.isDirectory()) stack.push(absolute);
      else if (child.isSymbolicLink()) symlinks += 1;
      else {
        try { bytes += fs.lstatSync(absolute).size; } catch {}
      }
      if (bytes > stopAfterBytes || entries > stopAfterEntries) {
        return {
          bytes, entries, symlinks, exceeded: true, reason: bytes > stopAfterBytes ? 'bytes' : 'inodes',
        };
      }
    }
  }
  return { bytes, entries, symlinks, exceeded: symlinks > 0, reason: symlinks > 0 ? 'symlink' : null };
}

export function quotaFilesystemUsage(records, temporaryDirectory, maximumBytes, maximumInodes) {
  const relative = path.resolve(temporaryDirectory);
  for (const record of records || []) {
    if (!record?.pid || record.state === 'Z') continue;
    const visible = path.join(`/proc/${record.pid}/root`, relative.replace(/^\/+/, ''));
    try {
      const stats = fs.statfsSync(visible);
      const blockSize = Number(stats.bsize);
      const total = Number(stats.blocks) * blockSize;
      // Only accept the private quota filesystem, never the much larger host /tmp.
      if (total > maximumBytes + blockSize) continue;
      const bytes = Math.max(0, (Number(stats.blocks) - Number(stats.bfree)) * blockSize);
      const entries = Math.max(0, Number(stats.files) - Number(stats.ffree));
      const walked = boundedDirectorySize(visible, maximumBytes, maximumInodes);
      const reason = walked.symlinks > 0 ? 'symlink' : entries > maximumInodes ? 'inodes' : 'bytes';
      return {
        bytes,
        entries,
        symlinks: walked.symlinks,
        exceeded: Number(stats.bfree) === 0 || bytes >= maximumBytes
          || entries > maximumInodes || walked.symlinks > 0,
        reason,
        quota_proven: true,
        total_bytes: total,
      };
    } catch {}
  }
  return null;
}

export function ownedDirectoryIdentity(directory) {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`runner-owned path is not a physical directory: ${resolved}`);
  }
  return {
    path: resolved, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
  };
}

export function removeOwnedDirectory(directory, expectedPrefix, ownership) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir())
    || !path.basename(resolved).startsWith(expectedPrefix)
    || ownership?.path !== resolved) {
    throw new Error(`refusing to remove non-runner directory: ${resolved}`);
  }
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()
    || String(stat.dev) !== ownership.dev || String(stat.ino) !== ownership.ino) {
    throw new Error(`refusing to remove runner directory whose ownership identity changed: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  return !fs.existsSync(resolved);
}

const OPERATION_CLAIM_RE = /^([1-9]\d*)-([1-9]\d*)-([a-f0-9]{32})\.json$/;

function readOperationClaim(file) {
  const name = path.basename(file);
  const match = name.match(OPERATION_CLAIM_RE);
  if (!match) return null;
  try {
    const stat = fs.lstatSync(file);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!stat.isFile() || stat.isSymbolicLink()
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || !['graphd', 'cleanup'].includes(value.type)
      || Number(value.pid) !== Number(match[1])
      || String(value.start_ticks || '') !== match[2]
      || String(value.nonce || '') !== match[3]) return null;
    return { file, name, value };
  } catch { return null; }
}

function operationClaims(directory) {
  try {
    return fs.readdirSync(directory)
      .map((name) => readOperationClaim(path.join(directory, name)))
      .filter(Boolean);
  } catch { return []; }
}

function removeExactOperationClaim(claim) {
  const current = readOperationClaim(claim.file);
  if (!current
    || current.value.type !== claim.value.type
    || Number(current.value.pid) !== Number(claim.value.pid)
    || String(current.value.start_ticks || '') !== String(claim.value.start_ticks || '')
    || current.value.nonce !== claim.value.nonce) return false;
  try { fs.unlinkSync(claim.file); } catch { return false; }
  return !fs.existsSync(claim.file);
}

export function removeOwnedRuntimePaths(candidates) {
  const remaining = [];
  const grouped = new Map();
  for (const candidate of candidates || []) {
    const resolved = path.resolve(candidate?.path || '');
    const parent = path.dirname(resolved);
    if (!grouped.has(parent)) grouped.set(parent, []);
    grouped.get(parent).push({ ...candidate, path: resolved });
  }
  for (const [runtime, entries] of grouped) {
    const lockCandidate = entries.find((candidate) => path.basename(candidate.path) === 'graphd.lock');
    const socketCandidate = entries.find((candidate) => path.basename(candidate.path) === 'graphd.sock');
    const expected = lockCandidate?.parent_identity || socketCandidate?.parent_identity;
    const child = lockCandidate?.child_identity || socketCandidate?.child_identity;
    const operationClaimPath = lockCandidate?.operation_claim || socketCandidate?.operation_claim;
    const operationsExpected = lockCandidate?.operations_identity || socketCandidate?.operations_identity;
    const managedPaths = [...new Set([
      ...entries.map((candidate) => candidate.path),
      operationClaimPath ? path.resolve(operationClaimPath) : null,
    ].filter(Boolean))];
    const keepExisting = () => {
      for (const candidate of managedPaths) {
        if (fs.existsSync(candidate)) remaining.push(candidate);
      }
    };
    let parent;
    try { parent = fs.lstatSync(runtime); } catch { parent = null; }
    const parentOwned = expected?.path === runtime
      && parent?.isDirectory() && !parent.isSymbolicLink()
      && String(parent.dev) === expected.dev && String(parent.ino) === expected.ino
      && Number(parent.uid) === Number(expected.uid);
    if (!managedPaths.some((candidate) => fs.existsSync(candidate))) continue;
    let operations;
    try { operations = fs.lstatSync(path.dirname(operationClaimPath || '')); } catch { operations = null; }
    const operationsOwned = parentOwned && operationClaimPath
      && operationsExpected?.path === path.dirname(path.resolve(operationClaimPath))
      && operations?.isDirectory() && !operations.isSymbolicLink()
      && String(operations.dev) === operationsExpected.dev
      && String(operations.ino) === operationsExpected.ino
      && Number(operations.uid) === Number(operationsExpected.uid);
    const childClaim = operationsOwned ? readOperationClaim(path.resolve(operationClaimPath)) : null;
    const claimOwned = childClaim?.value.type === 'graphd'
      && Number(childClaim.value.pid) === Number(child?.pid)
      && String(childClaim.value.start_ticks || '') === String(child?.start_ticks || '');
    if (!claimOwned || identityAlive(child)) {
      keepExisting();
      continue;
    }
    const operationsDirectory = path.dirname(childClaim.file);
    let blocked = false;
    for (const claim of operationClaims(operationsDirectory)) {
      if (claim.file === childClaim.file) continue;
      if (identityAlive(claim.value)) blocked = true;
      else removeExactOperationClaim(claim);
    }
    if (blocked) {
      keepExisting();
      continue;
    }
    const cleanupIdentity = processIdentity(process.pid);
    const nonce = crypto.randomBytes(16).toString('hex');
    const cleanupClaim = cleanupIdentity ? {
      file: path.join(
        operationsDirectory,
        `${cleanupIdentity.pid}-${cleanupIdentity.start_ticks}-${nonce}.json`,
      ),
      value: { type: 'cleanup', ...cleanupIdentity, nonce },
    } : null;
    try {
      if (!cleanupClaim) throw new Error('cleanup process identity is unavailable');
      fs.writeFileSync(cleanupClaim.file, `${JSON.stringify(cleanupClaim.value)}\n`, {
        flag: 'wx', mode: 0o600,
      });
    } catch {
      keepExisting();
      continue;
    }
    const replacement = operationClaims(operationsDirectory).find((claim) =>
      claim.file !== childClaim.file
      && claim.file !== cleanupClaim.file
      && identityAlive(claim.value));
    if (replacement) {
      removeExactOperationClaim(cleanupClaim);
      keepExisting();
      continue;
    }
    let lockOwned = false;
    if (lockCandidate) {
      try {
        const entry = fs.lstatSync(lockCandidate.path);
        const lock = JSON.parse(fs.readFileSync(lockCandidate.path, 'utf8'));
        lockOwned = entry.isFile() && !entry.isSymbolicLink()
          && Number(lock.pid) === Number(child.pid)
          && String(lock.start_ticks || '') === String(child.start_ticks);
      } catch {}
    }
    const socketExistsWithoutLock = socketCandidate && fs.existsSync(socketCandidate.path)
      && (!lockCandidate || !fs.existsSync(lockCandidate.path));
    const runtimeArtifactsAbsent = [socketCandidate, lockCandidate]
      .filter(Boolean).every((candidate) => !fs.existsSync(candidate.path));
    if (lockOwned) {
      for (const candidate of [socketCandidate, lockCandidate].filter(Boolean)) {
        try {
          const entry = fs.lstatSync(candidate.path);
          if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isSocket())) {
            remaining.push(candidate.path);
            continue;
          }
          fs.rmSync(candidate.path, { force: true });
        } catch (error) {
          if (error.code !== 'ENOENT') remaining.push(candidate.path);
        }
        if (fs.existsSync(candidate.path)) remaining.push(candidate.path);
      }
    } else if (!runtimeArtifactsAbsent || socketExistsWithoutLock) {
      removeExactOperationClaim(cleanupClaim);
      keepExisting();
      continue;
    }
    const artifactsRemain = [socketCandidate, lockCandidate]
      .filter(Boolean).some((candidate) => fs.existsSync(candidate.path));
    if (!artifactsRemain) removeExactOperationClaim(childClaim);
    removeExactOperationClaim(cleanupClaim);
    try { fs.rmdirSync(operationsDirectory); } catch {}
    keepExisting();
  }
  return [...new Set(remaining)];
}
