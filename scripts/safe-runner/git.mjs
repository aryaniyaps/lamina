import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  assertTrustedBinaryIdentity,
  trustedHostBinary,
} from './infrastructure.mjs';

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const FALSE_PROGRAM = process.platform === 'win32' ? 'cmd.exe /d /c exit 1' : '/bin/false';

// Every Git command used by the controller is read-only. These command-scope
// settings neutralize repository-local execution hooks while still allowing
// Git to read the index, refs, and object database that define the workload.
const INERT_CONFIG = Object.freeze([
  'core.fsmonitor=false',
  `core.hooksPath=${NULL_DEVICE}`,
  'core.pager=cat',
  'pager.status=false',
  'pager.diff=false',
  'credential.helper=',
  `core.sshCommand=${FALSE_PROGRAM}`,
  `gpg.program=${FALSE_PROGRAM}`,
  'diff.external=',
  'interactive.diffFilter=',
  `core.attributesFile=${NULL_DEVICE}`,
  'protocol.file.allow=never',
  'submodule.recurse=false',
  'fetch.recurseSubmodules=false',
]);

const FIXED_GIT_DIRECTORIES = Object.freeze(process.platform === 'win32'
  ? [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'cmd'),
    ]
  : ['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin']);
const GIT_BINARY_NAME = process.platform === 'win32' ? 'git.exe' : 'git';
const MAX_GIT_BINARY_BYTES = 256 * 1024 * 1024;
const MAX_UID_MAP_BYTES = 4_096;

let gitIdentity = null;
const SEALED_GIT_IDENTITY_FIELDS = Object.freeze([
  'path', 'dev', 'ino', 'uid', 'mode', 'size', 'digest',
]);
const MAX_SEALED_GIT_IDENTITY_BYTES = 4_096;
let sealedGitIdentityState = 'unseen';
let verifiedSealedGitIdentity = null;

const EXECUTABLE_SECTIONS = new Set([
  'alias', 'credential', 'diff', 'filter', 'gpg', 'include', 'includeif',
  'interactive', 'maintenance', 'merge', 'pager', 'protocol', 'sequence',
  'submodule', 'url',
]);
const EXECUTABLE_CORE_KEYS = new Set([
  'alternaterefscommand', 'askpass', 'editor', 'fsmonitor', 'gitproxy',
  'hookspath', 'pager', 'sshcommand', 'worktree',
]);
const EXECUTABLE_REMOTE_KEYS = new Set([
  'partialclonefilter', 'promisor', 'proxy', 'receivepack', 'uploadpack', 'vcs',
]);

function physicalBoundedFile(file, label, maximumBytes = 1024 * 1024) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(maximumBytes)
    || fs.realpathSync.native(file) !== file) {
    throw new Error(`${label} must be a bounded physical file`);
  }
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      throw new Error(`${label} changed while opening`);
    }
    return fs.readFileSync(descriptor, 'utf8');
  } finally { fs.closeSync(descriptor); }
}

function gitMetadataFromFilesystem(cwd) {
  let current;
  try { current = fs.realpathSync.native(cwd); } catch { return null; }
  while (true) {
    const marker = path.join(current, '.git');
    try {
      const stat = fs.lstatSync(marker);
      if (stat.isDirectory() && !stat.isSymbolicLink()
        && fs.realpathSync.native(marker) === marker) {
        if (fs.existsSync(path.join(marker, 'commondir'))) {
          throw new Error('physical .git directories with external commondir are not admitted');
        }
        return { gitDirectory: marker, common: marker };
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('Git worktree marker is not physical');
      }
      const text = physicalBoundedFile(marker, 'Git worktree marker', 8 * 1024).trim();
      const match = text.match(/^gitdir:\s*(.+)$/i);
      if (!match) throw new Error('Git worktree marker is invalid');
      const declaredGitDirectory = path.resolve(current, match[1]);
      const gitDirectory = fs.realpathSync.native(declaredGitDirectory);
      const gitStat = fs.lstatSync(declaredGitDirectory);
      if (gitDirectory !== declaredGitDirectory || !gitStat.isDirectory()
        || gitStat.isSymbolicLink()) throw new Error('Git worktree directory is not physical');
      const commondirFile = path.join(gitDirectory, 'commondir');
      let common = gitDirectory;
      if (fs.existsSync(commondirFile)) {
        const commondir = physicalBoundedFile(commondirFile, 'Git commondir', 8 * 1024).trim();
        const declaredCommon = path.resolve(gitDirectory, commondir);
        common = fs.realpathSync.native(declaredCommon);
        const commonStat = fs.lstatSync(declaredCommon);
        if (common !== declaredCommon || !commonStat.isDirectory()
          || commonStat.isSymbolicLink()) throw new Error('Git common directory is not physical');
      }
      return { gitDirectory, common };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function assertConfigTextInert(text, label) {
  let section = null;
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      const match = line.match(/^\[([A-Za-z0-9.-]+)(?:\s+"(?:[^"\\]|\\.)*")?\]\s*(?:[#;].*)?$/);
      if (!match) throw new Error(`${label} contains an ambiguous section`);
      section = match[1].toLowerCase();
      if (EXECUTABLE_SECTIONS.has(section)) {
        throw new Error(`${label} contains executable Git section ${section}`);
      }
      continue;
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*(?:=|$)/);
    if (!section || !match) throw new Error(`${label} contains ambiguous Git config syntax`);
    const key = match[1].toLowerCase();
    if ((section === 'core' && EXECUTABLE_CORE_KEYS.has(key))
      || (section === 'remote' && EXECUTABLE_REMOTE_KEYS.has(key))
      || (section === 'extensions' && key === 'partialclone')) {
      throw new Error(`${label} contains executable Git setting ${section}.${key}`);
    }
  }
}

export function assertRepositoryGitConfigInert(cwd) {
  const metadata = gitMetadataFromFilesystem(cwd);
  if (!metadata) return null;
  const alternates = path.join(metadata.common, 'objects', 'info', 'alternates');
  if (fs.existsSync(alternates)) {
    throw new Error('repository Git object alternates are outside sealed authority');
  }
  for (const [file, label] of [
    [path.join(metadata.common, 'config'), 'repository Git config'],
    [path.join(metadata.gitDirectory, 'config.worktree'), 'worktree Git config'],
  ]) {
    try { assertConfigTextInert(physicalBoundedFile(file, label), label); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return metadata;
}

export function trustedGitIdentity() {
  if (!gitIdentity) {
    gitIdentity = trustedHostBinary(GIT_BINARY_NAME, FIXED_GIT_DIRECTORIES);
  }
  return assertTrustedBinaryIdentity(gitIdentity);
}

function sealedGitError(message) {
  const error = new Error(message);
  error.code = 'LAMINA_SAFE_GIT_IDENTITY';
  return error;
}

function fixedGitCandidate(expectedPath) {
  if (process.platform === 'win32') return false;
  for (const directory of FIXED_GIT_DIRECTORIES) {
    try {
      const candidate = fs.realpathSync.native(path.join(directory, GIT_BINARY_NAME));
      if (candidate === expectedPath && fs.realpathSync.native(expectedPath) === expectedPath) {
        return true;
      }
    } catch {}
  }
  return false;
}

function boundedProcText(file, label) {
  const bytes = fs.readFileSync(file);
  if (bytes.length === 0 || bytes.length > MAX_UID_MAP_BYTES) {
    throw sealedGitError(`${label} is unavailable or outside its fixed bound`);
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw sealedGitError(`${label} is not canonical UTF-8`);
  }
  return text.trim();
}

function namespaceUidForHostUid(hostUid) {
  if (process.platform !== 'linux') return hostUid;
  const rows = boundedProcText('/proc/self/uid_map', 'user-namespace UID map')
    .split(/\r?\n/).map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/);
      if (!match) throw sealedGitError('user-namespace UID map is malformed');
      const values = match.slice(1).map(Number);
      if (values.some((value) => !Number.isSafeInteger(value) || value < 0)
        || values[2] === 0) throw sealedGitError('user-namespace UID map is malformed');
      return values;
    });
  for (const [namespaceStart, hostStart, length] of rows) {
    if (hostUid >= hostStart && hostUid - hostStart < length) {
      return namespaceStart + (hostUid - hostStart);
    }
  }
  // The outside launcher admits only root- or launcher-owned fixed candidates.
  // In bwrap's one-entry UID map, only host root can therefore be a valid
  // unmapped owner. Never let an arbitrary sealed UID authenticate merely by
  // matching the kernel overflow UID observed inside the namespace.
  if (hostUid !== 0) {
    throw sealedGitError('sealed workload Git has an unproved unmapped host UID');
  }
  const overflowUid = boundedProcText('/proc/sys/kernel/overflowuid', 'overflow UID');
  if (!/^(?:0|[1-9]\d*)$/.test(overflowUid)) {
    throw sealedGitError('overflow UID is malformed');
  }
  const value = Number(overflowUid);
  if (!Number.isSafeInteger(value) || value < 0) throw sealedGitError('overflow UID is malformed');
  return value;
}

function stableBinaryFields(stat) {
  return [stat.dev, stat.ino, stat.uid, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink];
}

function validateSealedGitContinuity(expected) {
  if (!fixedGitCandidate(expected.path)) {
    throw sealedGitError('sealed workload Git path is not an exact fixed physical Git candidate');
  }
  const pathBefore = fs.lstatSync(expected.path, { bigint: true });
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    throw sealedGitError('sealed workload Git path is not a physical file');
  }
  const descriptor = fs.openSync(expected.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || (before.mode & 0o111n) === 0n || (before.mode & 0o6022n) !== 0n
      || before.size < 0n || before.size > BigInt(MAX_GIT_BINARY_BYTES)
      || pathBefore.dev !== before.dev || pathBefore.ino !== before.ino
      || pathBefore.mode !== before.mode || pathBefore.size !== before.size) {
      throw sealedGitError('sealed workload Git is not a bounded non-setid non-writable executable');
    }
    const digest = crypto.createHash('sha256');
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < Number(before.size)) {
      const count = fs.readSync(descriptor, chunk, 0,
        Math.min(chunk.length, Number(before.size) - offset), offset);
      if (count === 0) throw sealedGitError('sealed workload Git ended while hashing');
      digest.update(chunk.subarray(0, count));
      offset += count;
    }
    if (fs.readSync(descriptor, chunk, 0, 1, offset) !== 0) {
      throw sealedGitError('sealed workload Git exceeded its bounded identity size');
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const pathAfter = fs.lstatSync(expected.path, { bigint: true });
    if (JSON.stringify(stableBinaryFields(before).map(String))
      !== JSON.stringify(stableBinaryFields(after).map(String))
      || pathAfter.dev !== after.dev || pathAfter.ino !== after.ino
      || pathAfter.mode !== after.mode || pathAfter.size !== after.size) {
      throw sealedGitError('sealed workload Git identity changed while hashing');
    }
    const actual = {
      path: expected.path,
      dev: String(after.dev),
      ino: String(after.ino),
      uid: Number(after.uid),
      mode: Number(after.mode & 0o7777n),
      size: String(after.size),
      digest: digest.digest('hex'),
    };
    for (const field of ['path', 'dev', 'ino', 'mode', 'size', 'digest']) {
      if (actual[field] !== expected[field]) {
        throw sealedGitError(`sealed workload Git ${field} changed inside the namespace`);
      }
    }
    if (actual.uid !== namespaceUidForHostUid(expected.uid)) {
      throw sealedGitError('sealed workload Git UID does not match the proved namespace translation');
    }
    return Object.freeze({ ...actual, controller_uid: expected.uid, namespace_uid: actual.uid });
  } finally { fs.closeSync(descriptor); }
}

function consumeSealedGitIdentity() {
  const encoded = process.env.LAMINA_SAFE_GIT_IDENTITY;
  if (encoded === undefined) return null;
  delete process.env.LAMINA_SAFE_GIT_IDENTITY;
  const malformed = () => {
    const error = new Error('sealed workload Git identity is malformed');
    error.code = 'LAMINA_SAFE_GIT_IDENTITY';
    return error;
  };
  if (typeof encoded !== 'string' || encoded.length === 0
    || encoded.length > MAX_SEALED_GIT_IDENTITY_BYTES
    || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw malformed();
  let bytes;
  let identity;
  try {
    bytes = Buffer.from(encoded, 'base64url');
    if (bytes.length === 0 || bytes.length > MAX_SEALED_GIT_IDENTITY_BYTES
      || bytes.toString('base64url') !== encoded) throw malformed();
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw malformed();
    identity = JSON.parse(text);
  } catch (error) {
    if (error?.code === 'LAMINA_SAFE_GIT_IDENTITY') throw error;
    throw malformed();
  }
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
    || JSON.stringify(Object.keys(identity).sort())
      !== JSON.stringify([...SEALED_GIT_IDENTITY_FIELDS].sort())
    || typeof identity.path !== 'string' || !path.isAbsolute(identity.path)
    || typeof identity.dev !== 'string' || !/^(?:0|[1-9]\d*)$/.test(identity.dev)
    || typeof identity.ino !== 'string' || !/^(?:0|[1-9]\d*)$/.test(identity.ino)
    || !Number.isSafeInteger(identity.uid) || identity.uid < 0
    || !Number.isSafeInteger(identity.mode) || identity.mode < 0 || identity.mode > 0o7777
    || typeof identity.size !== 'string' || !/^(?:0|[1-9]\d*)$/.test(identity.size)
    || typeof identity.digest !== 'string' || !/^[a-f0-9]{64}$/.test(identity.digest)) {
    throw malformed();
  }
  return identity;
}

function trustedGitIdentityForSpawn() {
  if (sealedGitIdentityState === 'poisoned') {
    const error = new Error('sealed workload Git identity previously failed validation');
    error.code = 'LAMINA_SAFE_GIT_IDENTITY';
    throw error;
  }
  const hasSeal = process.env.LAMINA_SAFE_GIT_IDENTITY !== undefined;
  if (sealedGitIdentityState === 'verified') {
    if (hasSeal) {
      try { consumeSealedGitIdentity(); } catch {}
      sealedGitIdentityState = 'poisoned';
      throw sealedGitError('sealed workload Git identity was unexpectedly supplied more than once');
    }
    try { return validateSealedGitContinuity(verifiedSealedGitIdentity); }
    catch (error) {
      sealedGitIdentityState = 'poisoned';
      throw error;
    }
  }
  let sealed;
  try {
    sealed = consumeSealedGitIdentity();
    if (!sealed) return trustedGitIdentity();
    const actual = validateSealedGitContinuity(sealed);
    verifiedSealedGitIdentity = Object.freeze({ ...sealed });
    sealedGitIdentityState = 'verified';
    return actual;
  } catch (error) {
    if (hasSeal) sealedGitIdentityState = 'poisoned';
    throw error;
  }
}

export function inertGitEnvironment({ objectDirectory = null } = {}) {
  const environment = {
    PATH: process.platform === 'win32' ? path.dirname(trustedGitIdentity().path) : '/usr/bin:/bin',
    HOME: process.platform === 'win32' ? 'C:\\nonexistent' : '/nonexistent',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: NULL_DEVICE,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: FALSE_PROGRAM,
    SSH_ASKPASS: FALSE_PROGRAM,
    GIT_PAGER: 'cat',
    GIT_EDITOR: FALSE_PROGRAM,
    GIT_SEQUENCE_EDITOR: FALSE_PROGRAM,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    LANG: 'C',
    LC_ALL: 'C',
  };
  if (objectDirectory) {
    if (!path.isAbsolute(objectDirectory)) {
      throw new Error('trusted Git object directory must be absolute');
    }
    environment.GIT_OBJECT_DIRECTORY = objectDirectory;
  }
  return environment;
}

export function trustedGitArguments(args) {
  return [
    '--no-pager',
    ...INERT_CONFIG.flatMap((value) => ['-c', value]),
    ...args,
  ];
}

export function spawnTrustedGit(cwd, args, {
  input = undefined,
  encoding = 'utf8',
  stdio = ['ignore', 'pipe', 'pipe'],
  timeout = 3_000,
  maxBuffer = 64 * 1024,
  objectDirectory = null,
} = {}) {
  const identity = trustedGitIdentityForSpawn();
  assertRepositoryGitConfigInert(cwd);
  return spawnSync(identity.path, trustedGitArguments(args), {
    cwd,
    input,
    encoding,
    stdio,
    timeout,
    maxBuffer,
    env: inertGitEnvironment({ objectDirectory }),
  });
}

export function inertRepositoryConfig({ objectFormat = 'sha1' } = {}) {
  if (!['sha1', 'sha256'].includes(objectFormat)) {
    throw new Error(`unsupported Git object format: ${objectFormat}`);
  }
  const lines = [
    '[core]',
    `\trepositoryformatversion = ${objectFormat === 'sha256' ? '1' : '0'}`,
    '\tfilemode = true',
    '\tbare = false',
    '\tlogallrefupdates = true',
    '\tfsmonitor = false',
    `\thooksPath = ${NULL_DEVICE}`,
  ];
  if (objectFormat === 'sha256') lines.push('[extensions]', '\tobjectformat = sha256');
  return `${lines.join('\n')}\n`;
}
