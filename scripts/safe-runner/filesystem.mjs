import fs from 'node:fs';
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

export function removeOwnedDirectory(directory, expectedPrefix) {
  const resolved = path.resolve(directory);
  const parent = path.dirname(resolved);
  if (!path.basename(resolved).startsWith(expectedPrefix) || !fs.existsSync(parent)) {
    throw new Error(`refusing to remove non-runner directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  return !fs.existsSync(resolved);
}
