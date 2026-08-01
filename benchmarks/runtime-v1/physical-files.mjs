import fs from 'node:fs';
import path from 'node:path';

const MAX_DESCRIPTOR_READ_BYTES = 4 * 1024 * 1024;

export function physicalIdentity(candidate, expected = 'directory', { requireSameOwner = true } = {}) {
  const resolved = path.resolve(candidate);
  const stat = fs.lstatSync(resolved, { bigint: true });
  const correctType = expected === 'directory' ? stat.isDirectory() : stat.isFile();
  if (!correctType || stat.isSymbolicLink()
    || (requireSameOwner && typeof process.getuid === 'function'
      && Number(stat.uid) !== process.getuid())) {
    throw new Error(`${resolved} is not a same-owner physical ${expected}`);
  }
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: Number(stat.uid),
    nlink: Number(stat.nlink),
  };
}

export function samePhysicalIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino && left?.uid === right?.uid;
}

export function assertPhysicalDirectoryAncestry(candidate) {
  const resolved = path.resolve(candidate);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  physicalIdentity(current, 'directory', { requireSameOwner: false });
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    physicalIdentity(current, 'directory', { requireSameOwner: current === resolved });
  }
  if (fs.realpathSync.native(resolved) !== resolved) {
    throw new Error(`${resolved} contains symlink indirection`);
  }
  return physicalIdentity(resolved, 'directory');
}

export function assertDirectoryIdentity(directory, expected) {
  const actual = assertPhysicalDirectoryAncestry(directory);
  if (!samePhysicalIdentity(actual, expected)) {
    throw new Error(`${path.resolve(directory)} directory identity changed`);
  }
  return actual;
}

export function readBoundedPhysicalFile(file, maximumBytes, {
  root = null,
  rootIdentity = null,
} = {}) {
  const resolved = path.resolve(file);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || maximumBytes > MAX_DESCRIPTOR_READ_BYTES) {
    throw new Error(`physical read requires a 1-${MAX_DESCRIPTOR_READ_BYTES} byte bound`);
  }
  if (root) {
    const resolvedRoot = path.resolve(root);
    if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`${resolved} escapes its physical artifact root`);
    }
    assertDirectoryIdentity(resolvedRoot, rootIdentity);
  }
  assertPhysicalDirectoryAncestry(path.dirname(resolved));
  let descriptor = null;
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.isSymbolicLink() || Number(opened.nlink) !== 1
      || Number(opened.size) > maximumBytes
      || (typeof process.getuid === 'function' && Number(opened.uid) !== process.getuid())) {
      throw new Error(`${resolved} is not a bounded single-link physical file`);
    }
    const bounded = Buffer.allocUnsafe(maximumBytes + 1);
    let length = 0;
    while (length < bounded.length) {
      const read = fs.readSync(descriptor, bounded, length, bounded.length - length, length);
      if (read === 0) break;
      length += read;
    }
    const afterRead = fs.fstatSync(descriptor, { bigint: true });
    if (length > maximumBytes || afterRead.size !== opened.size
      || Number(afterRead.size) !== length || afterRead.dev !== opened.dev
      || afterRead.ino !== opened.ino || afterRead.uid !== opened.uid
      || afterRead.nlink !== opened.nlink) {
      throw new Error(`${resolved} changed or exceeded its bound while it was read`);
    }
    const bytes = bounded.subarray(0, length);
    const named = physicalIdentity(resolved, 'file');
    const openedIdentity = {
      dev: String(opened.dev), ino: String(opened.ino), uid: Number(opened.uid), nlink: Number(opened.nlink),
    };
    if (!samePhysicalIdentity(named, openedIdentity) || named.nlink !== 1) {
      throw new Error(`${resolved} changed while it was read`);
    }
    if (root) assertDirectoryIdentity(root, rootIdentity);
    return bytes;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}
