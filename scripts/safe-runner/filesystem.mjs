import fs from 'node:fs';
import path from 'node:path';

export function boundedDirectorySize(root, stopAfterBytes = Number.MAX_SAFE_INTEGER) {
  let bytes = 0;
  let entries = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let children = [];
    try { children = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      entries += 1;
      const absolute = path.join(current, child.name);
      if (child.isDirectory()) stack.push(absolute);
      else {
        try { bytes += fs.lstatSync(absolute).size; } catch {}
      }
      if (bytes > stopAfterBytes) return { bytes, entries, exceeded: true };
    }
  }
  return { bytes, entries, exceeded: false };
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
