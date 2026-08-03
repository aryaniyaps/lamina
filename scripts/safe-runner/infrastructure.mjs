import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const FIXED_DIRECTORIES = Object.freeze(['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin']);
const MAX_BINARY_BYTES = 256 * 1024 * 1024;
const EXACT_EXECUTION_HOOKS = new Set([
  'BASH_ENV', 'ENV', 'CDPATH', 'GLOBIGNORE', 'SHELLOPTS',
  'LAMINA_SAFE_GIT_IDENTITY',
  'PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'PYTHONINSPECT',
  'PERL5OPT', 'PERL5LIB', 'PERL_LOCAL_LIB_ROOT', 'PERL_MB_OPT', 'PERL_MM_OPT',
  'RUBYOPT', 'RUBYLIB', 'GEM_HOME', 'GEM_PATH',
  'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS',
  'GCONV_PATH', 'GETCONF_DIR', 'LOCPATH', 'NLSPATH', 'HOSTALIASES', 'RES_OPTIONS',
]);
const EXECUTION_HOOK_PREFIXES = Object.freeze([
  'LD_', 'DYLD_', 'NODE_', 'BASH_FUNC_', 'PYTHON', 'PERL', 'RUBY', 'GIT_',
]);

export const SAFE_INFRASTRUCTURE_PATH = Object.freeze([
  path.dirname(process.execPath), ...FIXED_DIRECTORIES,
].filter((value, index, values) => values.indexOf(value) === index)).join(path.delimiter);

// Exact names remain exported for bwrap --unsetenv generation. The sanitizer
// additionally rejects whole dangerous families, including dynamically named
// exported Bash functions and runtime output/cache hooks.
export const EXECUTION_HOOK_ENVIRONMENT = Object.freeze([...EXACT_EXECUTION_HOOKS]);
export const SAFE_RUNNER_TEST_ONLY_RETRIEVAL_ENVIRONMENT = Object.freeze([
  'LAMINA_TEST_RETRIEVAL_EMBEDDER',
  'LAMINA_TEST_RETRIEVAL_NO_EXTENSIONS',
]);
export const SAFE_RUNNER_RETRIEVAL_SEMANTIC_ENVIRONMENT = Object.freeze([
  'LAMINA_UV_BINARY',
  'LAMINA_STANDALONE',
  'LAMINA_WORKER',
  'LAMINA_MODEL',
  'LAMINA_BINARY',
]);
const SEALED_RETRIEVAL_ENV_ENTRYPOINTS = new Set([
  'benchmarks/retrieval-v1/benchmark.mjs',
  'benchmarks/real-repository-oracle-v1/workload.mjs',
  'tests/retrieval_native_index_test.mjs',
  'tests/cli_binary_smoke_test.mjs',
]);

export function isExecutionHookEnvironment(name) {
  return EXACT_EXECUTION_HOOKS.has(name)
    || EXECUTION_HOOK_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function trustedPhysicalPathEqual(left, right, platform = process.platform) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (platform === 'win32') {
    const normalizedLeft = path.win32.normalize(left);
    const normalizedRight = path.win32.normalize(right);
    const leftDrive = normalizedLeft.match(/^([A-Za-z]):(.*)$/s);
    const rightDrive = normalizedRight.match(/^([A-Za-z]):(.*)$/s);
    if (leftDrive && rightDrive) {
      return leftDrive[1].toLowerCase() === rightDrive[1].toLowerCase()
        && leftDrive[2] === rightDrive[2];
    }
    return normalizedLeft === normalizedRight;
  }
  return left === right;
}

export function trustedReadOpenFlags(platform = process.platform) {
  if (platform === 'win32') {
    // Windows has no O_NOFOLLOW. The surrounding lstat -> opened fstat ->
    // post-read fstat -> final lstat continuity is the fail-closed substitute.
    return fs.constants.O_RDONLY;
  }
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) {
    throw new Error('trusted executable no-follow open is unavailable');
  }
  return fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
}

export function trustedBinaryStatPolicy({
  platform = process.platform,
  regularFile,
  symbolicLink,
  mode,
  uid,
  currentUid = null,
  requireRootOwnership = false,
} = {}) {
  if (regularFile !== true || symbolicLink !== false
    || typeof mode !== 'bigint' || typeof uid !== 'bigint') return false;
  // Node exposes no Windows owner/group/other or executable-mode authority.
  // Windows trust comes from the fixed physical path and stable file identity.
  if (platform === 'win32') return requireRootOwnership === false;
  return (mode & 0o111n) !== 0n
    && (mode & 0o6022n) === 0n
    && (!requireRootOwnership || uid === 0n)
    && (currentUid === null || uid === 0n || uid === BigInt(currentUid));
}

const TRUSTED_BINARY_STABLE_FIELDS = Object.freeze([
  'dev', 'ino', 'uid', 'gid', 'mode', 'size', 'nlink', 'mtimeNs', 'ctimeNs',
]);

export function trustedBinaryStableFields(stat) {
  if (!stat || TRUSTED_BINARY_STABLE_FIELDS.some((field) => typeof stat[field] !== 'bigint')) {
    return null;
  }
  return Object.freeze(Object.fromEntries(
    TRUSTED_BINARY_STABLE_FIELDS.map((field) => [field, String(stat[field])]),
  ));
}

export function sameTrustedBinaryStableFields(left, right) {
  const leftFields = trustedBinaryStableFields(left);
  const rightFields = trustedBinaryStableFields(right);
  return leftFields !== null && rightFields !== null
    && JSON.stringify(leftFields) === JSON.stringify(rightFields);
}

function binaryDigest(file, expected, platform) {
  const size = Number(expected.size);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BINARY_BYTES) {
    const error = new Error(`trusted executable exceeds the ${MAX_BINARY_BYTES}-byte identity budget`);
    error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
    throw error;
  }
  const descriptor = fs.openSync(file, trustedReadOpenFlags(platform));
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameTrustedBinaryStableFields(expected, opened)) {
      throw new Error('trusted executable changed while opening');
    }
    const hash = crypto.createHash('sha256');
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < size) {
      const count = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, size - offset), offset);
      if (count === 0) throw new Error('trusted executable ended while hashing');
      hash.update(chunk.subarray(0, count));
      offset += count;
    }
    if (fs.readSync(descriptor, chunk, 0, 1, offset) !== 0) {
      throw new Error('trusted executable exceeded its bounded identity size');
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const namedAfter = fs.lstatSync(file, { bigint: true });
    if (!sameTrustedBinaryStableFields(opened, after)
      || !sameTrustedBinaryStableFields(after, namedAfter)
      || !trustedPhysicalPathEqual(fs.realpathSync.native(file), file, platform)) {
      throw new Error('trusted executable identity changed while hashing');
    }
    return Object.freeze({ digest: hash.digest('hex'), stat: after });
  } finally { fs.closeSync(descriptor); }
}

function assertTrustedAncestors(file, {
  requireRootOwnership = false, platform = process.platform,
} = {}) {
  let current = path.dirname(file);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  while (true) {
    const stat = fs.lstatSync(current);
    const windows = platform === 'win32';
    const writableByForeignGroup = !windows && (stat.mode & 0o020) !== 0 && stat.uid !== uid;
    const writableByWorld = !windows && (stat.mode & 0o002) !== 0;
    const protectedStickyRoot = !windows && writableByWorld
      && stat.uid === 0 && (stat.mode & 0o1000) !== 0;
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || (windows && !trustedPhysicalPathEqual(fs.realpathSync.native(current), current, platform))
      || (!windows && requireRootOwnership && stat.uid !== 0)
      || (!windows && uid !== null && stat.uid !== 0 && stat.uid !== uid)
      || (!windows && !protectedStickyRoot && (writableByWorld || writableByForeignGroup))) {
      const error = new Error(`trusted executable has an unsafe ancestor: ${current}`);
      error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
      throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function trustedBinaryIdentity(candidate, {
  expectedDigest = null, requireRootOwnership = false,
} = {}) {
  const absolute = path.resolve(candidate);
  const physical = fs.realpathSync.native(absolute);
  if (!trustedPhysicalPathEqual(physical, absolute)) {
    const error = new Error(`trusted executable must be supplied by its physical path: ${absolute}`);
    error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
    throw error;
  }
  const stat = fs.lstatSync(physical, { bigint: true });
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!trustedBinaryStatPolicy({
    regularFile: stat.isFile(), symbolicLink: stat.isSymbolicLink(), mode: stat.mode,
    uid: stat.uid, currentUid: uid, requireRootOwnership,
  })) {
    const detail = process.platform === 'win32' ? 'bounded physical file at fixed Windows authority'
      : 'non-setid, non-writable root/current-user physical file';
    const error = new Error(`trusted executable must be a ${detail}: ${absolute}`);
    error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
    throw error;
  }
  assertTrustedAncestors(physical, { requireRootOwnership });
  const verified = binaryDigest(physical, stat, process.platform);
  assertTrustedAncestors(physical, { requireRootOwnership });
  if (expectedDigest && verified.digest !== expectedDigest) {
    const error = new Error(`trusted executable digest mismatch: ${absolute}`);
    error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
    throw error;
  }
  return {
    path: physical,
    dev: String(verified.stat.dev),
    ino: String(verified.stat.ino),
    uid: Number(verified.stat.uid),
    mode: Number(verified.stat.mode & 0o7777n),
    size: String(verified.stat.size),
    digest: verified.digest,
    ...(requireRootOwnership
      ? { nlink: Number(verified.stat.nlink), root_owned_path: true } : {}),
  };
}

export function trustedRootBinaryIdentity(candidate, { expectedDigest = null } = {}) {
  const identity = trustedBinaryIdentity(candidate, { expectedDigest, requireRootOwnership: true });
  let getcap = null;
  for (const directory of FIXED_DIRECTORIES) {
    try {
      getcap = trustedBinaryIdentity(fs.realpathSync.native(path.join(directory, 'getcap')), {
        requireRootOwnership: true,
      });
      break;
    } catch {}
  }
  if (!getcap) {
    const error = new Error('trusted root-owned getcap is required to attest system executable capabilities');
    error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
    throw error;
  }
  const capabilityProbe = spawnSync(getcap.path, ['-n', identity.path], {
    encoding: 'utf8', env: sanitizedEnvironment(), timeout: 2_000,
    maxBuffer: 4_096, windowsHide: true,
  });
  if (capabilityProbe.error || capabilityProbe.status !== 0 || capabilityProbe.signal
    || capabilityProbe.stdout.trim() || capabilityProbe.stderr.trim()) {
    const error = new Error(`trusted root-owned executable must have no file capabilities: ${identity.path}`);
    error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
    throw error;
  }
  return { ...identity, file_capabilities: 'empty' };
}

export function assertTrustedBinaryIdentity(expected) {
  const requireRootOwnership = expected?.root_owned_path === true;
  const actual = requireRootOwnership
    ? trustedRootBinaryIdentity(expected?.path, { expectedDigest: expected?.digest })
    : trustedBinaryIdentity(expected?.path, { expectedDigest: expected?.digest });
  const fields = ['path', 'dev', 'ino', 'uid', 'mode', 'size', 'digest'];
  if (requireRootOwnership) fields.push('nlink', 'root_owned_path', 'file_capabilities');
  for (const field of fields) {
    if (actual[field] !== expected?.[field]) {
      const error = new Error(`trusted executable identity changed before launch: ${expected?.path || 'unknown'}`);
      error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY_CHANGED';
      throw error;
    }
  }
  return actual;
}

export function trustedHostBinary(name, candidates = FIXED_DIRECTORIES) {
  for (const directory of candidates) {
    const candidate = path.join(directory, name);
    try {
      return trustedBinaryIdentity(process.platform === 'win32'
        ? candidate : fs.realpathSync.native(candidate));
    } catch {}
  }
  const error = new Error(`trusted infrastructure binary is unavailable: ${name}`);
  error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
  throw error;
}

export function trustedRootHostBinary(name, candidates = FIXED_DIRECTORIES) {
  for (const directory of candidates) {
    const candidate = path.join(directory, name);
    try { return trustedRootBinaryIdentity(fs.realpathSync.native(candidate)); } catch {}
  }
  const error = new Error(`trusted root-owned infrastructure binary is unavailable: ${name}`);
  error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
  throw error;
}

let cachedInfrastructure = null;
export function infrastructureBinaries() {
  if (cachedInfrastructure) return cachedInfrastructure;
  const pinnedPath = process.env.LAMINA_SAFE_BWRAP_PATH;
  const pinnedDigest = process.env.LAMINA_SAFE_BWRAP_SHA256;
  let bwrap;
  if (pinnedPath || pinnedDigest) {
    if (!path.isAbsolute(pinnedPath || '') || !/^[a-f0-9]{64}$/.test(pinnedDigest || '')) {
      const error = new Error('pinned bwrap requires absolute LAMINA_SAFE_BWRAP_PATH and SHA-256 LAMINA_SAFE_BWRAP_SHA256');
      error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
      throw error;
    }
    bwrap = trustedBinaryIdentity(pinnedPath, { expectedDigest: pinnedDigest });
  } else {
    bwrap = trustedRootHostBinary('bwrap');
  }
  const identities = {
    systemctl: trustedHostBinary('systemctl'),
    systemdRun: trustedHostBinary('systemd-run'),
    bwrap,
    shell: trustedBinaryIdentity(fs.realpathSync.native('/bin/sh')),
    node: trustedBinaryIdentity(fs.realpathSync.native(process.execPath)),
  };
  cachedInfrastructure = Object.freeze({
    systemctl: identities.systemctl.path,
    systemdRun: identities.systemdRun.path,
    bwrap: identities.bwrap.path,
    shell: identities.shell.path,
    node: identities.node.path,
    identities: Object.freeze(identities),
    pinned_bwrap: Boolean(pinnedPath),
  });
  return cachedInfrastructure;
}

export function assertInfrastructureBinaries(binaries, names = Object.keys(binaries?.identities || {})) {
  for (const name of names) assertTrustedBinaryIdentity(binaries?.identities?.[name]);
  return true;
}

export function sanitizedEnvironment(...sources) {
  const result = Object.assign({}, ...sources);
  for (const name of Object.keys(result)) {
    if (isExecutionHookEnvironment(name)) delete result[name];
  }
  result.PATH = SAFE_INFRASTRUCTURE_PATH;
  result.GIT_CONFIG_NOSYSTEM = '1';
  result.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return result;
}

export function sanitizedPayloadEnvironment({
  sources = [], mode = 'run', auditedEntrypoint = null, sealedOverrides = {},
} = {}) {
  const result = sanitizedEnvironment(...sources);
  const stripsRetrievalSemantics = SEALED_RETRIEVAL_ENV_ENTRYPOINTS.has(auditedEntrypoint);
  const stripsOracleSemantics = auditedEntrypoint === 'benchmarks/real-repository-oracle-v1/workload.mjs';
  for (const name of Object.keys(result)) {
    if (mode !== 'self-test' && name.startsWith('LAMINA_TEST_')) delete result[name];
    if (stripsRetrievalSemantics && (name.startsWith('LAMINA_RETRIEVAL_')
      || SAFE_RUNNER_RETRIEVAL_SEMANTIC_ENVIRONMENT.includes(name))) delete result[name];
    if (stripsOracleSemantics && name.startsWith('ORACLE_')) delete result[name];
  }
  Object.assign(result, sealedOverrides);
  return result;
}
