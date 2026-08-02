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
  const symlinkPaths = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let children = [];
    try { children = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      entries += 1;
      const absolute = path.join(current, child.name);
      if (child.isDirectory()) stack.push(absolute);
      else if (child.isSymbolicLink()) {
        symlinks += 1;
        const relative = path.relative(root, absolute).replaceAll('\\', '/');
        if (symlinkPaths.length < 16 && relative.length <= 256
          && !/[\u0000-\u001f\u007f]/.test(relative)) symlinkPaths.push(relative);
      }
      else {
        try { bytes += fs.lstatSync(absolute).size; } catch {}
      }
      if (bytes > stopAfterBytes || entries > stopAfterEntries) {
        return {
          bytes, entries, symlinks, symlink_paths: symlinkPaths,
          exceeded: true, reason: bytes > stopAfterBytes ? 'bytes' : 'inodes',
        };
      }
    }
  }
  return {
    bytes, entries, symlinks, symlink_paths: symlinkPaths,
    exceeded: symlinks > 0, reason: symlinks > 0 ? 'symlink' : null,
  };
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
        symlink_paths: walked.symlink_paths,
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
  const stat = fs.lstatSync(resolved, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    const error = new Error(`runner-owned path is not a physical directory: ${resolved}`);
    error.code = 'LAMINA_SAFE_DIRECTORY_IDENTITY';
    throw error;
  }
  return {
    path: resolved,
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: Number(stat.uid),
  };
}

export function removeOwnedDirectory(directory, expectedPrefix, expectedIdentity) {
  const resolved = path.resolve(directory);
  const parent = path.dirname(resolved);
  if (!path.basename(resolved).startsWith(expectedPrefix) || !fs.existsSync(parent)
    || !expectedIdentity || expectedIdentity.path !== resolved) {
    throw new Error(`refusing to remove non-runner directory: ${resolved}`);
  }
  let actual;
  try { actual = ownedDirectoryIdentity(resolved); } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
  if (actual.dev !== String(expectedIdentity.dev)
    || actual.ino !== String(expectedIdentity.ino)
    || actual.uid !== Number(expectedIdentity.uid)
    || (typeof process.getuid === 'function' && actual.uid !== process.getuid())) {
    const error = new Error(`refusing to remove runner directory whose ownership identity changed: ${resolved}`);
    error.code = 'LAMINA_SAFE_DIRECTORY_IDENTITY';
    throw error;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  return !fs.existsSync(resolved);
}
