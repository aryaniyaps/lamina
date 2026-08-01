import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FIXED_DIRECTORIES = Object.freeze(['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin']);
const MAX_BINARY_BYTES = 256 * 1024 * 1024;
const EXACT_EXECUTION_HOOKS = new Set([
  'BASH_ENV', 'ENV', 'CDPATH', 'GLOBIGNORE', 'SHELLOPTS',
  'PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'PYTHONINSPECT',
  'PERL5OPT', 'PERL5LIB', 'PERL_LOCAL_LIB_ROOT', 'PERL_MB_OPT', 'PERL_MM_OPT',
  'RUBYOPT', 'RUBYLIB', 'GEM_HOME', 'GEM_PATH',
  'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS',
  'GCONV_PATH', 'GETCONF_DIR', 'LOCPATH', 'NLSPATH', 'HOSTALIASES', 'RES_OPTIONS',
]);
const EXECUTION_HOOK_PREFIXES = Object.freeze([
  'LD_', 'DYLD_', 'NODE_', 'BASH_FUNC_', 'PYTHON', 'PERL', 'RUBY',
]);

export const SAFE_INFRASTRUCTURE_PATH = Object.freeze([
  path.dirname(process.execPath), ...FIXED_DIRECTORIES,
].filter((value, index, values) => values.indexOf(value) === index)).join(path.delimiter);

// Exact names remain exported for bwrap --unsetenv generation. The sanitizer
// additionally rejects whole dangerous families, including dynamically named
// exported Bash functions and runtime output/cache hooks.
export const EXECUTION_HOOK_ENVIRONMENT = Object.freeze([...EXACT_EXECUTION_HOOKS]);

export function isExecutionHookEnvironment(name) {
  return EXACT_EXECUTION_HOOKS.has(name)
    || EXECUTION_HOOK_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function binaryDigest(file, size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BINARY_BYTES) {
    const error = new Error(`trusted executable exceeds the ${MAX_BINARY_BYTES}-byte identity budget`);
    error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
    throw error;
  }
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertTrustedAncestors(file) {
  let current = path.dirname(file);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  while (true) {
    const stat = fs.lstatSync(current);
    const writableByForeignGroup = (stat.mode & 0o020) !== 0 && stat.uid !== uid;
    const writableByWorld = (stat.mode & 0o002) !== 0;
    const protectedStickyRoot = writableByWorld && stat.uid === 0 && (stat.mode & 0o1000) !== 0;
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || (uid !== null && stat.uid !== 0 && stat.uid !== uid)
      || (!protectedStickyRoot && (writableByWorld || writableByForeignGroup))) {
      const error = new Error(`trusted executable has an unsafe ancestor: ${current}`);
      error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
      throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function trustedBinaryIdentity(candidate, { expectedDigest = null } = {}) {
  const absolute = path.resolve(candidate);
  const physical = fs.realpathSync.native(absolute);
  if (physical !== absolute) {
    const error = new Error(`trusted executable must be supplied by its physical path: ${absolute}`);
    error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
    throw error;
  }
  const stat = fs.lstatSync(physical, { bigint: true });
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111n) === 0n
    || (stat.mode & 0o022n) !== 0n
    || (uid !== null && Number(stat.uid) !== 0 && Number(stat.uid) !== uid)) {
    const error = new Error(`trusted executable must be a non-writable root/current-user physical file: ${absolute}`);
    error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
    throw error;
  }
  assertTrustedAncestors(physical);
  const digest = binaryDigest(physical, Number(stat.size));
  if (expectedDigest && digest !== expectedDigest) {
    const error = new Error(`trusted executable digest mismatch: ${absolute}`);
    error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
    throw error;
  }
  return {
    path: physical,
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: Number(stat.uid),
    mode: Number(stat.mode & 0o777n),
    size: String(stat.size),
    digest,
  };
}

export function assertTrustedBinaryIdentity(expected) {
  const actual = trustedBinaryIdentity(expected?.path, { expectedDigest: expected?.digest });
  for (const field of ['path', 'dev', 'ino', 'uid', 'mode', 'size', 'digest']) {
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
    try { return trustedBinaryIdentity(fs.realpathSync.native(candidate)); } catch {}
  }
  const error = new Error(`trusted infrastructure binary is unavailable: ${name}`);
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
    bwrap = trustedHostBinary('bwrap');
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
  return result;
}
