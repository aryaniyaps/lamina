import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
    const expected = lockCandidate?.parent_identity;
    const child = lockCandidate?.child_identity;
    let parent;
    try { parent = fs.lstatSync(runtime); } catch { parent = null; }
    const parentOwned = expected?.path === runtime
      && parent?.isDirectory() && !parent.isSymbolicLink()
      && String(parent.dev) === expected.dev && String(parent.ino) === expected.ino
      && Number(parent.uid) === Number(expected.uid);
    let lockOwned = false;
    if (parentOwned && lockCandidate && child?.pid && child?.start_ticks) {
      try {
        const entry = fs.lstatSync(lockCandidate.path);
        const lock = JSON.parse(fs.readFileSync(lockCandidate.path, 'utf8'));
        lockOwned = entry.isFile() && !entry.isSymbolicLink()
          && Number(lock.pid) === Number(child.pid)
          && String(lock.start_ticks || '') === String(child.start_ticks);
      } catch {}
    }
    if (!lockOwned) {
      for (const candidate of entries) {
        if (fs.existsSync(candidate.path)) remaining.push(candidate.path);
      }
      continue;
    }
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
  }
  return [...new Set(remaining)];
}
