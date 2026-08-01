import fs from 'node:fs';
import path from 'node:path';

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
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('physical read requires a positive safe byte bound');
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
    const bytes = fs.readFileSync(descriptor);
    const named = physicalIdentity(resolved, 'file');
    const openedIdentity = {
      dev: String(opened.dev), ino: String(opened.ino), uid: Number(opened.uid), nlink: Number(opened.nlink),
    };
    if (!samePhysicalIdentity(named, openedIdentity) || named.nlink !== 1 || bytes.length !== Number(opened.size)) {
      throw new Error(`${resolved} changed while it was read`);
    }
    if (root) assertDirectoryIdentity(root, rootIdentity);
    return bytes;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}
