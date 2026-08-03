import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnTrustedGit } from '../../scripts/safe-runner/git.mjs';
import { processIdentity } from '../../scripts/safe-runner/processes.mjs';
import { loadReviewedFixture } from './fixture-authority.mjs';
import {
  digest,
  collectionDigest,
  isSafeBranchName,
  isSafeRelativePath,
  materializationBaseDigest,
  materializationProvenanceDigest,
} from './contract.mjs';
import { readRepositoryState } from './repository-state.mjs';

export const PERSISTENT_MATERIALIZER_SCHEMA =
  'lamina.real-repository-oracle-persistent-materializer/v1';
export const PERSISTENT_MATERIALIZER_RECOVERY_SCHEMA =
  'lamina.real-repository-oracle-persistent-materializer-recovery/v1';
export const PERSISTENT_MATERIALIZER_RECOVERY_ACK_SCHEMA =
  'lamina.real-repository-oracle-persistent-materializer-recovery-ack/v1';

const OWNER_FILE = '.owner.json';
const ROOT_PREFIX = 'real-repository-oracle-materializer-';
const CACHE_NAME = 'cache.git';
const LEASES_NAME = 'leases';
const ROOT_QUARANTINE_PREFIX = '.lamina-materializer-quarantine-';
const CONTAMINATED_QUARANTINE_PREFIX = '.lamina-materializer-contaminated-';
const MAX_GIT_OUTPUT = 8 * 1024 * 1024;
const MAX_PACK_FILES = 2;
const DEFAULT_MAX_PACK_BYTES = 768 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_FILES = 120_000;
const DEFAULT_MAX_SNAPSHOT_BYTES = 768 * 1024 * 1024;
const HANDLE = /^[a-f0-9]{64}$/;
const OID = /^[a-f0-9]{40}$/;
const OWNED_GIT_ROOTS = new Set();
const HAS_POSIX_OWNERSHIP = process.platform !== 'win32'
  && typeof process.getuid === 'function';

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function frozenClone(value) {
  const clone = structuredClone(value);
  const pending = [clone];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || Object.isFrozen(current)) continue;
    for (const child of Object.values(current)) pending.push(child);
    Object.freeze(current);
  }
  return clone;
}

function exactOptions(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label} options must be an exact plain data object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label} options contain missing, inherited, or unsupported authority`);
  }
  const sanitized = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new Error(`${label} options must contain enumerable data properties only`);
    }
    sanitized[key] = descriptor.value;
  }
  return sanitized;
}

function ownedGitRoot(cwd) {
  const physical = fs.realpathSync.native(path.resolve(cwd));
  return [...OWNED_GIT_ROOTS].find((root) => physical === root
    || physical.startsWith(`${root}${path.sep}`));
}

function assertMaterializerGitInvocation(cwd, args) {
  const root = ownedGitRoot(cwd);
  if (!root || !Array.isArray(args) || args.some((item) => typeof item !== 'string')) {
    throw new Error('persistent materializer Git invocation escapes owned authority');
  }
  const withinRoot = (candidate) => {
    if (!path.isAbsolute(candidate) || path.resolve(candidate) !== candidate
      || (candidate !== root && !candidate.startsWith(`${root}${path.sep}`))) return false;
    try {
      const physicalParent = fs.realpathSync.native(path.dirname(candidate));
      return physicalParent === root || physicalParent.startsWith(`${root}${path.sep}`);
    } catch { return false; }
  };
  const oidWithType = (value) => /^[a-f0-9]{40}\^\{(?:commit|tree)\}$/.test(value);
  let admitted = false;
  if (args[0] === 'rev-parse') admitted = args.length === 3
    && args[1] === '--verify' && oidWithType(args[2]);
  else if (args[0] === 'fsck') admitted = args.length === 5
    && args.slice(1, 4).join('\0') === ['--full', '--strict', '--no-reflogs'].join('\0')
    && OID.test(args[4]);
  else if (args[0] === 'init') admitted = (args.length === 3 || args.length === 4)
    && args[1] === '--quiet' && (args.length === 3 || args[2] === '--bare')
    && withinRoot(args.at(-1));
  else if (args[0] === 'update-ref') admitted = args.length === 3
    && args[1] === 'refs/lamina/cache-pin' && OID.test(args[2]);
  else if (args[0] === 'fetch') admitted = args.length === 6
    && args.slice(1, 4).join('\0') === ['--quiet', '--no-tags', '--depth=1'].join('\0')
    && /^https:\/\//.test(args[4]) && /^\+[a-f0-9]{40}:refs\/lamina\/cache-pin$/.test(args[5]);
  else if (args[0] === '-c') admitted = args.length === 5
    && args[1] === 'pack.writeReverseIndex=false' && args[2] === 'repack'
    && args[3] === '-Ad' && args[4] === '--no-write-bitmap-index';
  else if (args[0] === 'prune-packed') admitted = args.length === 1;
  else if (args[0] === 'count-objects') admitted = args.length === 2 && args[1] === '-v';
  else if (args[0] === '--literal-pathspecs') admitted = args.length === 5
    && args[1] === 'mv' && args[2] === '--'
    && isSafeRelativePath(args[3]) && isSafeRelativePath(args[4]);
  else if (args[0] === 'checkout') {
    admitted = (args.length === 4 && args[1] === '--quiet' && args[2] === '--detach'
      && OID.test(args[3]))
      || (args.length === 6 && args[1] === '--quiet' && args[2] === '--no-track'
        && args[3] === '-b' && isSafeBranchName(args[4]) && OID.test(args[5]));
  } else if (args[0] === 'worktree') {
    admitted = (args.length === 8 && args[1] === 'add' && args[2] === '--quiet'
      && args[3] === '--no-track' && args[4] === '-b' && isSafeBranchName(args[5])
      && withinRoot(args[6]) && OID.test(args[7]))
      || (args.length === 4 && args[1] === 'remove' && args[2] === '--'
        && withinRoot(args[3]));
  } else if (args[0] === 'show-ref') admitted = args.length === 4
    && args[1] === '--hash' && args[2] === '--verify'
    && /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(args[3]);
  else if (args[0] === 'branch') admitted = args.length === 4
    && args[1] === '-D' && args[2] === '--' && isSafeBranchName(args[3]);
  if (!admitted) throw new Error(`persistent materializer Git command is not admitted: ${args[0] || ''}`);
}

function checkedGit(cwd, args, timeout = 60_000) {
  assertMaterializerGitInvocation(cwd, args);
  const result = spawnTrustedGit(cwd, ['-c', 'core.symlinks=false', ...args], {
    encoding: 'utf8', timeout, maxBuffer: MAX_GIT_OUTPUT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(`persistent materializer trusted Git failed (${args[0]}): ${String(result.stderr || '').slice(-2000)}`);
  }
  return String(result.stdout || '');
}

function physicalDirectory(candidate, label, { privateMode = true } = {}) {
  const declared = path.resolve(String(candidate || ''));
  const physical = fs.realpathSync.native(declared);
  const stat = fs.lstatSync(declared, { bigint: true });
  if (!path.isAbsolute(String(candidate || '')) || declared !== String(candidate)
    || physical !== declared || !stat.isDirectory() || stat.isSymbolicLink()
    || (HAS_POSIX_OWNERSHIP && (stat.uid !== BigInt(process.getuid())
      || (privateMode && (stat.mode & 0o077n) !== 0n)))) {
    throw new Error(`${label} must be an exact private physical directory`);
  }
  return { path: physical, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid) };
}

function sameIdentity(left, right) {
  return left?.path === right?.path && String(left?.dev) === String(right?.dev)
    && String(left?.ino) === String(right?.ino) && Number(left?.uid) === Number(right?.uid);
}

function physicalFile(file, label, maximumBytes = DEFAULT_MAX_PACK_BYTES) {
  const declared = path.resolve(file);
  const physical = fs.realpathSync.native(declared);
  const stat = fs.lstatSync(declared, { bigint: true });
  if (physical !== declared || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
    || stat.size < 1n || stat.size > BigInt(maximumBytes)
    || (HAS_POSIX_OWNERSHIP && stat.uid !== BigInt(process.getuid()))) {
    throw new Error(`${label} must be a bounded physical single-link file`);
  }
  return stat;
}

function readExactJson(file, label) {
  physicalFile(file, label, 16 * 1024);
  const bytes = fs.readFileSync(file);
  let value;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes) || !text.endsWith('\n')) throw new Error();
    value = JSON.parse(text);
  } catch { throw new Error(`${label} is not canonical bounded UTF-8 JSON`); }
  return value;
}

function validOwnerIdentity(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(['pid', 'start_ticks'])
    && Number.isSafeInteger(value.pid) && value.pid > 1
    && typeof value?.start_ticks === 'string' && /^\d+$/.test(value.start_ticks);
}

function assertCurrentRecoveryOwner(value) {
  const current = processIdentity(process.pid);
  if (!validOwnerIdentity(value) || !current || !same(value, current)) {
    throw new Error('persistent materializer recovery owner must be the exact current live host process');
  }
  return frozenClone(current);
}

function recoveryAuthorityFromMarker(marker) {
  return frozenClone({
    schema: PERSISTENT_MATERIALIZER_RECOVERY_SCHEMA,
    root: marker.root,
    root_identity: marker.root_identity,
    parent_identity: marker.parent_identity,
    authority_token: marker.authority_token,
    recovery_owner_identity: marker.recovery_owner_identity,
  });
}

export function persistentMaterializerRecoveryAck(authority) {
  return Object.freeze({
    schema: PERSISTENT_MATERIALIZER_RECOVERY_ACK_SCHEMA,
    authority_sha256: digest(authority),
  });
}

function writeOwnerMarker(root, parentIdentity, recoveryOwnerIdentity, authorityToken) {
  const rootIdentity = physicalDirectory(root, 'persistent materializer root');
  const marker = {
    schema: PERSISTENT_MATERIALIZER_SCHEMA,
    root,
    root_identity: rootIdentity,
    parent_identity: parentIdentity,
    recovery_owner_identity: frozenClone(recoveryOwnerIdentity),
    authority_token: authorityToken,
    owned: [CACHE_NAME, LEASES_NAME],
  };
  fs.writeFileSync(path.join(root, OWNER_FILE), `${JSON.stringify(marker)}\n`, {
    flag: 'wx', mode: 0o600,
  });
  return marker;
}

function validateRoot(root, expectedMarker = null) {
  const rootIdentity = physicalDirectory(root, 'persistent materializer root');
  const marker = readExactJson(path.join(root, OWNER_FILE), 'persistent materializer owner marker');
  if (marker?.schema !== PERSISTENT_MATERIALIZER_SCHEMA || marker.root !== root
    || !sameIdentity(marker.root_identity, rootIdentity)
    || !/^[a-f0-9]{64}$/.test(marker.authority_token || '')
    || !validOwnerIdentity(marker.recovery_owner_identity)
    || JSON.stringify(marker.owned) !== JSON.stringify([CACHE_NAME, LEASES_NAME])
    || (expectedMarker && (!same(marker, expectedMarker)))) {
    throw new Error('persistent materializer owner marker or physical identity changed');
  }
  const allowed = new Set([OWNER_FILE, CACHE_NAME, LEASES_NAME]);
  const foreign = fs.readdirSync(root).filter((name) => !allowed.has(name));
  if (foreign.length) throw new Error(`persistent materializer root contains foreign entries: ${foreign.join(', ')}`);
  physicalDirectory(path.join(root, CACHE_NAME), 'persistent materializer cache');
  physicalDirectory(path.join(root, LEASES_NAME), 'persistent materializer leases');
  return marker;
}

function validateRootEnvelope(actualRoot, declaredRoot = actualRoot) {
  const rootIdentity = physicalDirectory(actualRoot, 'persistent materializer root');
  const marker = readExactJson(path.join(actualRoot, OWNER_FILE), 'persistent materializer owner marker');
  if (marker?.schema !== PERSISTENT_MATERIALIZER_SCHEMA || marker.root !== declaredRoot
    || !sameNodeIdentity(marker.root_identity, rootIdentity)
    || marker.root_identity?.path !== declaredRoot
    || !/^[a-f0-9]{64}$/.test(marker.authority_token || '')
    || !validOwnerIdentity(marker.recovery_owner_identity)
    || JSON.stringify(marker.owned) !== JSON.stringify([CACHE_NAME, LEASES_NAME])) {
    throw new Error('persistent materializer owner marker or physical identity changed');
  }
  return { marker };
}

function scanTree(root, {
  maximumFiles = DEFAULT_MAX_SNAPSHOT_FILES,
  maximumBytes = DEFAULT_MAX_SNAPSHOT_BYTES,
  allowEmptyFiles = true,
} = {}) {
  const physicalRoot = physicalDirectory(root, 'owned materializer tree', { privateMode: false }).path;
  const pending = [{ absolute: physicalRoot, relative: '' }];
  const rows = [];
  let files = 0;
  let bytes = 0;
  while (pending.length) {
    const directory = pending.pop();
    const directoryStat = fs.lstatSync(directory.absolute, { bigint: true });
    rows.push({
      path: directory.relative || '.', kind: 'directory', mode: String(directoryStat.mode),
      uid: String(directoryStat.uid), ino: String(directoryStat.ino),
      mtime_ns: String(directoryStat.mtimeNs), ctime_ns: String(directoryStat.ctimeNs),
    });
    for (const name of fs.readdirSync(directory.absolute).sort().reverse()) {
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
        throw new Error('owned materializer tree contains an invalid entry name');
      }
      const absolute = path.join(directory.absolute, name);
      const relative = directory.relative ? `${directory.relative}/${name}` : name;
      const stat = fs.lstatSync(absolute, { bigint: true });
      if (stat.isSymbolicLink()) throw new Error(`owned materializer tree contains a symlink: ${relative}`);
      if (stat.isDirectory()) {
        pending.push({ absolute, relative });
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1n) {
        throw new Error(`owned materializer tree contains a special path or hardlink: ${relative}`);
      }
      files += 1;
      bytes += Number(stat.size);
      if (files > maximumFiles || bytes > maximumBytes
        || (!allowEmptyFiles && stat.size === 0n)) {
        throw new Error('owned materializer tree exceeds its bounded file or byte authority');
      }
      rows.push({
        path: relative, kind: 'file', mode: String(stat.mode), uid: String(stat.uid),
        ino: String(stat.ino), size: String(stat.size), mtime_ns: String(stat.mtimeNs),
        ctime_ns: String(stat.ctimeNs), sha256: sha256(fs.readFileSync(absolute)),
      });
    }
  }
  rows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return Object.freeze({ files, bytes, digest: digest(rows), rows: Object.freeze(rows) });
}

function packClosure(repository, maximumPackBytes) {
  const packDirectory = path.join(repository, 'objects', 'pack');
  physicalDirectory(packDirectory, 'packed object cache directory', { privateMode: false });
  const names = fs.readdirSync(packDirectory).sort();
  if (names.length !== MAX_PACK_FILES) {
    throw new Error('packed object cache must contain exactly one pack and one index');
  }
  const pack = names.find((name) => /^pack-[a-f0-9]{40,64}\.pack$/.test(name));
  const index = names.find((name) => /^pack-[a-f0-9]{40,64}\.idx$/.test(name));
  const base = pack?.slice(0, -5);
  if (!pack || !index || base !== index.slice(0, -4)
    || names.some((name) => ![pack, index].includes(name))) {
    throw new Error('packed object cache has foreign suffixes or mismatched companions');
  }
  let total = 0;
  const records = [pack, index].map((name) => {
    const file = path.join(packDirectory, name);
    const stat = physicalFile(file, `packed object cache ${name}`, maximumPackBytes);
    total += Number(stat.size);
    if (total > maximumPackBytes) throw new Error('packed object cache exceeds its byte bound');
    return Object.freeze({ name, file, size: Number(stat.size), sha256: sha256(fs.readFileSync(file)), stat });
  });
  return Object.freeze({ packDirectory, total_bytes: total, records });
}

function copyPhysicalFile(source, destination, expected, maximumBytes, copyInterposition = null) {
  const before = physicalFile(source, 'packed cache source', maximumBytes);
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  copyInterposition?.(source, destination);
  fs.chmodSync(destination, 0o400);
  const after = physicalFile(source, 'packed cache source after copy', maximumBytes);
  const copied = physicalFile(destination, 'independent lease object copy', maximumBytes);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
    || copied.dev === before.dev && copied.ino === before.ino
    || copied.nlink !== 1n || Number(copied.size) !== expected.size
    || sha256(fs.readFileSync(destination)) !== expected.sha256) {
    throw new Error('lease object copy is not byte-exact and physically independent');
  }
}

function copyPackedClosure(sourceRepository, destinationRepository, maximumPackBytes,
  copyInterposition = null) {
  const source = packClosure(sourceRepository, maximumPackBytes);
  const destinationPack = path.join(destinationRepository, 'objects', 'pack');
  for (const record of source.records) {
    copyPhysicalFile(record.file, path.join(destinationPack, record.name), record,
      maximumPackBytes, copyInterposition);
  }
  const shallowSource = path.join(sourceRepository, 'shallow');
  if (fs.existsSync(shallowSource)) {
    const stat = physicalFile(shallowSource, 'packed cache shallow boundary', 1024 * 1024);
    const expected = { size: Number(stat.size), sha256: sha256(fs.readFileSync(shallowSource)) };
    copyPhysicalFile(shallowSource, path.join(destinationRepository, 'shallow'), expected,
      1024 * 1024, copyInterposition);
  }
  return source;
}

function makeReadOnly(root) {
  const pending = [root];
  const directories = [];
  while (pending.length) {
    const current = pending.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('cache sealing encountered a symlink');
    if (stat.isDirectory()) {
      directories.push(current);
      for (const name of fs.readdirSync(current)) pending.push(path.join(current, name));
    } else if (stat.isFile()) fs.chmodSync(current, 0o400);
    else throw new Error('cache sealing encountered a special path');
  }
  for (const directory of directories.reverse()) fs.chmodSync(directory, 0o500);
}

function verifyPin(repository, collection) {
  const commit = checkedGit(repository, ['rev-parse', '--verify', `${collection.commit}^{commit}`]).trim();
  const tree = checkedGit(repository, ['rev-parse', '--verify', `${collection.commit}^{tree}`]).trim();
  if (commit !== collection.commit || tree !== collection.tree_oid) {
    throw new Error('packed object closure does not resolve the exact reviewed commit and tree');
  }
  checkedGit(repository, ['fsck', '--full', '--strict', '--no-reflogs', collection.commit], 120_000);
}

function initializeCache(cache, collection, seedBareRepository, maximumPackBytes,
  copyInterposition = null) {
  checkedGit(path.dirname(cache), ['init', '--quiet', '--bare', cache]);
  if (seedBareRepository) {
    const seed = physicalDirectory(seedBareRepository,
      'synthetic packed bare cache seed', { privateMode: false }).path;
    copyPackedClosure(seed, cache, maximumPackBytes, copyInterposition);
    checkedGit(cache, ['update-ref', 'refs/lamina/cache-pin', collection.commit]);
  } else {
    checkedGit(cache, [
      'fetch', '--quiet', '--no-tags', '--depth=1', collection.repository_url,
      `+${collection.commit}:refs/lamina/cache-pin`,
    ], 20 * 60_000);
    checkedGit(cache, ['-c', 'pack.writeReverseIndex=false',
      'repack', '-Ad', '--no-write-bitmap-index'], 20 * 60_000);
    checkedGit(cache, ['prune-packed'], 120_000);
  }
  verifyPin(cache, collection);
  const closure = packClosure(cache, maximumPackBytes);
  const loose = checkedGit(cache, ['count-objects', '-v']);
  const count = Number(/^count: (\d+)$/m.exec(loose)?.[1]);
  const packs = Number(/^packs: (\d+)$/m.exec(loose)?.[1]);
  if (count !== 0 || packs !== 1) throw new Error('cache is not one exact packed bare object closure');
  makeReadOnly(cache);
  return closure;
}

function safeOwnedPath(root, relative, { missing = false } = {}) {
  if (!isSafeRelativePath(relative)) throw new Error(`unsafe scenario path: ${JSON.stringify(relative)}`);
  const target = path.join(root, ...relative.split('/'));
  const parent = fs.realpathSync.native(path.dirname(target));
  const physicalRoot = fs.realpathSync.native(root);
  if (parent !== physicalRoot && !parent.startsWith(`${physicalRoot}${path.sep}`)) {
    throw new Error('scenario path parent escapes the physical lease');
  }
  if (!missing) {
    const stat = physicalFile(target, 'scenario source', DEFAULT_MAX_SNAPSHOT_BYTES);
    return { target, stat, sha256: sha256(fs.readFileSync(target)) };
  }
  try { fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return { target }; throw error; }
  throw new Error('scenario destination unexpectedly exists');
}

function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object' || !Array.isArray(scenario.operations)
    || !['clean', 'dirty', 'branch', 'worktree'].includes(scenario.kind)
    || (scenario.kind === 'clean') !== (scenario.operations.length === 0)) {
    throw new Error('reviewed repository scenario is malformed');
  }
  if (scenario.kind !== 'clean' && scenario.operations.length !== 1) {
    throw new Error('persistent materializer requires one exact reviewed scenario operation');
  }
  const operation = scenario.operations[0];
  if (scenario.kind === 'dirty' && !['modify', 'rename', 'delete'].includes(operation?.op)) {
    throw new Error('dirty scenario operation is unsupported');
  }
  if (scenario.kind === 'branch' && operation?.op !== 'checkout_branch') {
    throw new Error('branch scenario operation is unsupported');
  }
  if (scenario.kind === 'worktree' && operation?.op !== 'add_worktree') {
    throw new Error('worktree scenario operation is unsupported');
  }
  if (operation?.path && !isSafeRelativePath(operation.path)) throw new Error('scenario path is unsafe');
  if (operation?.to && !isSafeRelativePath(operation.to)) throw new Error('scenario destination is unsafe');
  if (operation?.branch && !isSafeBranchName(operation.branch)) throw new Error('scenario branch is unsafe');
  if (operation?.worktree_id && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(operation.worktree_id)) {
    throw new Error('scenario worktree role is invalid');
  }
  if (operation?.op === 'modify' && (typeof operation.content !== 'string'
    || !operation.content || Buffer.byteLength(operation.content) > 64 * 1024)) {
    throw new Error('scenario modification content is invalid');
  }
  return operation;
}

function createLeaseMarker(leaseRoot, handle) {
  const identity = physicalDirectory(leaseRoot, 'physical lease root');
  const marker = { schema: `${PERSISTENT_MATERIALIZER_SCHEMA}/lease`, handle, identity };
  fs.writeFileSync(path.join(leaseRoot, OWNER_FILE), `${JSON.stringify(marker)}\n`, {
    flag: 'wx', mode: 0o600,
  });
  return marker;
}

function validateLeaseMarker(leaseRoot, marker) {
  const actual = readExactJson(path.join(leaseRoot, OWNER_FILE), 'physical lease owner marker');
  const identity = physicalDirectory(leaseRoot, 'physical lease root');
  if (!same(actual, marker) || !sameIdentity(marker.identity, identity)) {
    throw new Error('physical lease ownership marker changed');
  }
}

function activateScenario(repository, leaseRoot, collection, scenario) {
  const operation = validateScenario(scenario);
  const proof = { operation: operation ? frozenClone(operation) : null };
  let activeRepository = repository;
  let worktreeRole = 'primary';
  if (!operation) return { activeRepository, worktreeRole, proof };
  if (operation.op === 'modify') {
    const source = safeOwnedPath(repository, operation.path);
    const descriptor = fs.openSync(source.target,
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      if (opened.dev !== source.stat.dev || opened.ino !== source.stat.ino || opened.nlink !== 1n) {
        throw new Error('scenario modification source changed while opening');
      }
      fs.writeFileSync(descriptor, Buffer.from(operation.content));
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    proof.before_sha256 = source.sha256;
    proof.after_sha256 = sha256(fs.readFileSync(source.target));
  } else if (operation.op === 'rename') {
    const source = safeOwnedPath(repository, operation.path);
    safeOwnedPath(repository, operation.to, { missing: true });
    checkedGit(repository, ['--literal-pathspecs', 'mv', '--', operation.path, operation.to]);
    proof.before_sha256 = source.sha256;
    proof.after_sha256 = sha256(fs.readFileSync(path.join(repository, ...operation.to.split('/'))));
  } else if (operation.op === 'delete') {
    const source = safeOwnedPath(repository, operation.path);
    fs.unlinkSync(source.target);
    if (fs.existsSync(source.target)) throw new Error('scenario deletion path remains present');
    proof.before_sha256 = source.sha256;
  } else if (operation.op === 'checkout_branch') {
    checkedGit(repository, ['checkout', '--quiet', '--no-track', '-b', operation.branch, collection.commit]);
  } else if (operation.op === 'add_worktree') {
    const linkedRoot = path.join(leaseRoot, 'linked');
    fs.mkdirSync(linkedRoot, { mode: 0o700 });
    activeRepository = path.join(linkedRoot, operation.worktree_id);
    checkedGit(repository, [
      'worktree', 'add', '--quiet', '--no-track', '-b', operation.branch,
      activeRepository, collection.commit,
    ]);
    worktreeRole = operation.worktree_id;
  }
  return { activeRepository, worktreeRole, proof };
}

function refValue(repository, branch) {
  return checkedGit(repository, ['show-ref', '--hash', '--verify', `refs/heads/${branch}`]).trim();
}

function verifyScenarioActive(authority) {
  const { repository, activeRepository, worktreeRole, expectedState, scenario, collection, proof } = authority;
  const actual = readRepositoryState(activeRepository, { worktreeRole });
  if (!same(actual, expectedState)) {
    throw new Error(`active repository state differs from reviewed fixture authority: ${JSON.stringify(actual)}`);
  }
  const operation = scenario.operations[0];
  if (!operation) return actual;
  if (operation.op === 'modify') {
    const source = safeOwnedPath(repository, operation.path);
    if (source.sha256 !== proof.after_sha256) throw new Error('active modified content differs from activation proof');
  } else if (operation.op === 'rename') {
    if (fs.existsSync(path.join(repository, ...operation.path.split('/')))
      || sha256(fs.readFileSync(path.join(repository, ...operation.to.split('/')))) !== proof.before_sha256) {
      throw new Error('active rename topology or content differs from activation proof');
    }
  } else if (operation.op === 'delete') {
    if (fs.existsSync(path.join(repository, ...operation.path.split('/')))) {
      throw new Error('active delete path returned');
    }
  } else if (operation.op === 'checkout_branch') {
    if (refValue(repository, operation.branch) !== collection.commit) {
      throw new Error('active branch ref differs from reviewed commit');
    }
  } else if (operation.op === 'add_worktree') {
    if (refValue(repository, operation.branch) !== collection.commit) {
      throw new Error('active linked-worktree ref differs from reviewed commit');
    }
    const primary = readRepositoryState(repository, { worktreeRole: 'primary' });
    const expectedPrimary = {
      head: collection.commit, branch: '(detached)', upstream: null,
      ahead: 0, behind: 0, worktree_role: 'primary', changes: [],
    };
    if (!same(primary, expectedPrimary)) throw new Error('primary worktree changed while linked role was active');
    const marker = path.join(activeRepository, '.git');
    physicalFile(marker, 'linked-worktree marker', 8 * 1024);
    const text = fs.readFileSync(marker, 'utf8').trim();
    const match = /^gitdir: (.+)$/.exec(text);
    const admin = match ? fs.realpathSync.native(path.resolve(activeRepository, match[1])) : null;
    const common = fs.realpathSync.native(path.join(repository, '.git'));
    if (!admin || !admin.startsWith(`${common}${path.sep}worktrees${path.sep}`)
      || path.basename(admin) !== operation.worktree_id) {
      throw new Error('linked-worktree admin authority escapes or differs from its logical role');
    }
    physicalDirectory(admin, 'linked-worktree admin directory', { privateMode: false });
    authority.linkedAdmin = admin;
  }
  return actual;
}

function deactivateScenario(authority) {
  const operation = authority.scenario.operations[0];
  if (!operation) return;
  if (operation.op === 'checkout_branch') {
    checkedGit(authority.repository, ['checkout', '--quiet', '--detach', authority.collection.commit]);
    checkedGit(authority.repository, ['branch', '-D', '--', operation.branch]);
  } else if (operation.op === 'add_worktree') {
    checkedGit(authority.repository, ['worktree', 'remove', '--', authority.activeRepository]);
    checkedGit(authority.repository, ['branch', '-D', '--', operation.branch]);
    if (fs.existsSync(authority.activeRepository) || fs.existsSync(authority.linkedAdmin)) {
      throw new Error('linked worktree path or admin state remains after deactivation');
    }
  }
}

function assertAbsent(candidate, label) {
  try { fs.lstatSync(candidate); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`${label} remains present after verified removal`);
}

function sameNodeIdentity(left, right) {
  return String(left?.dev) === String(right?.dev) && String(left?.ino) === String(right?.ino)
    && Number(left?.uid) === Number(right?.uid);
}

function openAuthenticatedDirectory(candidate, expectedIdentity, label) {
  const descriptor = fs.openSync(candidate,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || String(stat.dev) !== String(expectedIdentity?.dev)
      || String(stat.ino) !== String(expectedIdentity?.ino)
      || Number(stat.uid) !== Number(expectedIdentity?.uid)) {
      throw new Error(`${label} descriptor identity changed`);
    }
    return descriptor;
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function readMarkerFromDirectoryDescriptor(descriptor, label) {
  const markerPath = `/proc/self/fd/${descriptor}/${OWNER_FILE}`;
  const markerDescriptor = fs.openSync(markerPath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(markerDescriptor, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
      || stat.size < 1n || stat.size > 16n * 1024n) {
      throw new Error(`${label} marker is not a bounded physical file`);
    }
    const bytes = fs.readFileSync(markerDescriptor);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes) || !text.endsWith('\n')) {
      throw new Error(`${label} marker is not canonical UTF-8 JSON`);
    }
    return JSON.parse(text);
  } finally { fs.closeSync(markerDescriptor); }
}

function discoverOwnedDirectory(parent, expectedIdentity, preferred) {
  const names = fs.readdirSync(parent);
  if (names.length > DEFAULT_MAX_SNAPSHOT_FILES) {
    throw new Error('owned quarantine parent exceeds its discovery bound');
  }
  const matches = [];
  for (const name of names) {
    const candidate = path.join(parent, name);
    let stat;
    try { stat = fs.lstatSync(candidate, { bigint: true }); } catch { continue; }
    if (stat.isDirectory() && !stat.isSymbolicLink()
      && String(stat.dev) === String(expectedIdentity.dev)
      && String(stat.ino) === String(expectedIdentity.ino)
      && Number(stat.uid) === Number(expectedIdentity.uid)) matches.push(candidate);
  }
  if (matches.length !== 1) return null;
  return Object.freeze({
    path: matches[0], preferred_path: preferred,
    pathname_stable: matches[0] === preferred,
  });
}

function quarantineExactOwnedDirectory(source, parentIdentity, expectedIdentity,
  expectedMarker, label, quarantineName, lifecycleInterposition = null) {
  const parent = physicalDirectory(path.dirname(source), `${label} parent`);
  const before = physicalDirectory(source, label);
  if (!sameIdentity(parent, parentIdentity) || !sameIdentity(before, expectedIdentity)) {
    throw new Error(`${label} identity changed before quarantine`);
  }
  if (!/^(?:\.lamina-materializer-quarantine-[a-f0-9]{64}|\.lamina-lease-quarantine-[a-f0-9]{64})$/.test(quarantineName)) {
    throw new Error(`${label} quarantine name is outside deterministic authority`);
  }
  const quarantine = path.join(parent.path, quarantineName);
  assertAbsent(quarantine, `${label} quarantine destination`);
  const descriptor = openAuthenticatedDirectory(source, expectedIdentity, label);
  try {
    fs.renameSync(source, quarantine);
    assertAbsent(source, label);
    const afterParent = physicalDirectory(parent.path, `${label} parent`);
    const after = physicalDirectory(quarantine, `${label} quarantine`);
    const actualMarker = readExactJson(path.join(quarantine, OWNER_FILE), `${label} owner marker`);
    const openedAfterRename = fs.fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(afterParent, parentIdentity) || !sameNodeIdentity(after, expectedIdentity)
      || String(openedAfterRename.dev) !== String(expectedIdentity.dev)
      || String(openedAfterRename.ino) !== String(expectedIdentity.ino)
      || !same(actualMarker, expectedMarker)) {
      throw new Error(`${label} was substituted during quarantine`);
    }
    lifecycleInterposition?.(Object.freeze({
      boundary: 'after_quarantine_rename', label, source, quarantine,
    }));
    if (!same(readMarkerFromDirectoryDescriptor(descriptor, label), expectedMarker)) {
      throw new Error(`${label} authenticated marker changed after quarantine`);
    }
    const discovered = discoverOwnedDirectory(parent.path, expectedIdentity, quarantine);
    return Object.freeze({
      cleanup_verified: false,
      terminal_disposition: discovered
        ? 'awaiting_supervisor_cleanup' : 'owned_quarantine_path_lost',
      quarantine: discovered?.path || null,
      preferred_quarantine: quarantine,
      pathname_stable: discovered?.pathname_stable || false,
      owned_identity: frozenClone(expectedIdentity),
    });
  } finally { fs.closeSync(descriptor); }
}

function removeExactOwnedRoot(root, marker, lifecycleInterposition = null) {
  validateRoot(root, marker);
  scanTree(root);
  return quarantineExactOwnedDirectory(root, marker.parent_identity, marker.root_identity,
    marker, 'persistent materializer root',
    `${ROOT_QUARANTINE_PREFIX}${marker.authority_token}`, lifecycleInterposition);
}

function createPersistentScenarioMaterializerInternal({
  runnerTemporaryRoot,
  collection,
  recoveryOwnerIdentity,
  publishRecoveryAuthority,
  seedBareRepository = null,
  maximumPackBytes = DEFAULT_MAX_PACK_BYTES,
  maximumSnapshotFiles = DEFAULT_MAX_SNAPSHOT_FILES,
  maximumSnapshotBytes = DEFAULT_MAX_SNAPSHOT_BYTES,
  syntheticCopyInterposition = null,
  syntheticLifecycleInterposition = null,
}) {
  if (process.platform !== 'linux') {
    throw new Error('persistent materializer requires Linux process and physical ownership semantics');
  }
  const authenticatedRecoveryOwner = assertCurrentRecoveryOwner(recoveryOwnerIdentity);
  if (typeof publishRecoveryAuthority !== 'function') {
    throw new Error('persistent materializer requires synchronous recovery authority publication');
  }
  const parentIdentity = physicalDirectory(runnerTemporaryRoot, 'safe-runner temporary authority');
  if (!collection || !/^https:\/\//.test(collection.repository_url || '')
    || !/^[a-f0-9]{40}$/.test(collection.commit || '')
    || !/^[a-f0-9]{40}$/.test(collection.tree_oid || '')
    || !/^[a-f0-9]{64}$/.test(collection.candidate_policy_sha256 || '')
    || collection.collection_digest !== collectionDigest(collection)) {
    throw new Error('persistent materializer collection authority is invalid');
  }
  let physicalSeed = null;
  if (seedBareRepository) {
    physicalSeed = physicalDirectory(seedBareRepository,
      'synthetic packed bare cache seed', { privateMode: false }).path;
    if (!physicalSeed.startsWith(`${parentIdentity.path}${path.sep}`)) {
      throw new Error('synthetic packed cache seed escapes the safe-runner temporary authority');
    }
  }
  const authorityToken = crypto.randomBytes(32).toString('hex');
  const root = path.join(parentIdentity.path, `${ROOT_PREFIX}${authorityToken}`);
  assertAbsent(root, 'intended persistent materializer root');
  const constructionAuthority = frozenClone({
    schema: PERSISTENT_MATERIALIZER_RECOVERY_SCHEMA,
    root,
    parent_identity: parentIdentity,
    authority_token: authorityToken,
    recovery_owner_identity: authenticatedRecoveryOwner,
  });
  const expectedAck = persistentMaterializerRecoveryAck(constructionAuthority);
  if (!same(publishRecoveryAuthority(constructionAuthority), expectedAck)) {
    throw new Error('persistent materializer recovery authority publication was not acknowledged');
  }
  syntheticLifecycleInterposition?.(Object.freeze({
    boundary: 'before_root_creation', authority: constructionAuthority,
  }));
  fs.mkdirSync(root, { mode: 0o700 });
  const createdRootIdentity = physicalDirectory(root, 'new persistent materializer root');
  syntheticLifecycleInterposition?.(Object.freeze({
    boundary: 'after_root_creation', authority: constructionAuthority,
    root_identity: createdRootIdentity,
  }));
  OWNED_GIT_ROOTS.add(root);
  const cache = path.join(root, CACHE_NAME);
  const leases = path.join(root, LEASES_NAME);
  const frozenCollection = frozenClone(collection);
  let marker;
  let cacheSnapshot;
  try {
    fs.mkdirSync(cache, { mode: 0o700 });
    fs.mkdirSync(leases, { mode: 0o700 });
    marker = writeOwnerMarker(root, parentIdentity, authenticatedRecoveryOwner, authorityToken);
    const finalAuthority = recoveryAuthorityFromMarker(marker);
    if (!same(publishRecoveryAuthority(finalAuthority),
      persistentMaterializerRecoveryAck(finalAuthority))) {
      throw new Error('persistent materializer final recovery authority publication was not acknowledged');
    }
    syntheticLifecycleInterposition?.(Object.freeze({
      boundary: 'after_owner_marker', authority: finalAuthority,
    }));
    initializeCache(cache, frozenCollection, physicalSeed, maximumPackBytes,
      syntheticCopyInterposition);
    cacheSnapshot = scanTree(cache, {
      maximumFiles: maximumSnapshotFiles, maximumBytes: maximumSnapshotBytes,
    });
    validateRoot(root, marker);
  } catch (error) {
    OWNED_GIT_ROOTS.delete(root);
    error.message = `${error.message}; published root authority is retained for supervisor cleanup`;
    throw error;
  }

  const prepared = new Map();
  const issued = new Set();
  let active = null;
  let closed = false;
  let terminalDisposition = null;

  const requireOpen = () => {
    if (closed) throw new Error('persistent materializer is closed');
    if (terminalDisposition) {
      throw new Error('persistent materializer awaits independently verified supervisor cleanup');
    }
    validateRoot(root, marker);
    const actualCache = scanTree(cache, {
      maximumFiles: maximumSnapshotFiles, maximumBytes: maximumSnapshotBytes,
    });
    if (actualCache.digest !== cacheSnapshot.digest) throw new Error('packed bare cache changed');
  };

  const api = {
    async prepare(scenario, suppliedCollection) {
      requireOpen();
      if (!same(suppliedCollection, frozenCollection)) throw new Error('prepared collection differs from materializer authority');
      const operation = validateScenario(scenario);
      void operation;
      const scenarioDigest = digest(scenario);
      const base = {
        schema: 'lamina.materialized-repository-base/v1',
        resolved_commit: frozenCollection.commit,
        tree_oid: frozenCollection.tree_oid,
        scenario_digest: scenarioDigest,
        provenance_digest: materializationProvenanceDigest(frozenCollection, scenarioDigest),
        content_digest: materializationBaseDigest(frozenCollection, scenarioDigest),
      };
      const existing = prepared.get(base.provenance_digest);
      if (existing && !same(existing.scenario, scenario)) throw new Error('scenario digest authority collided');
      prepared.set(base.provenance_digest, { scenario: frozenClone(scenario), base: frozenClone(base) });
      return frozenClone(base);
    },

    async lease(base, context) {
      requireOpen();
      if (active) throw new Error('only one persistent repository lease may be active');
      const preparedAuthority = prepared.get(base?.provenance_digest);
      if (!preparedAuthority || !same(base, preparedAuthority.base)) throw new Error('lease base was not prepared by this materializer');
      const expectedState = context?.expected_repository_state;
      if (!expectedState || typeof expectedState !== 'object' || Array.isArray(expectedState)) {
        throw new Error('lease requires private expected repository state authority');
      }
      const handle = crypto.randomBytes(32).toString('hex');
      if (!HANDLE.test(handle) || issued.has(handle)) throw new Error('fresh lease handle generation failed');
      issued.add(handle);
      const leaseRoot = path.join(leases, `lease-${handle}`);
      fs.mkdirSync(leaseRoot, { mode: 0o700 });
      const leaseMarker = createLeaseMarker(leaseRoot, handle);
      const repository = path.join(leaseRoot, 'repository');
      try {
        checkedGit(leaseRoot, ['init', '--quiet', repository]);
        const closure = copyPackedClosure(cache, path.join(repository, '.git'), maximumPackBytes);
        verifyPin(repository, frozenCollection);
        checkedGit(repository, ['checkout', '--quiet', '--detach', frozenCollection.commit]);
        verifyPin(repository, frozenCollection);
        const initial = readRepositoryState(repository, { worktreeRole: 'primary' });
        const clean = {
          head: frozenCollection.commit, branch: '(detached)', upstream: null,
          ahead: 0, behind: 0, worktree_role: 'primary', changes: [],
        };
        if (!same(initial, clean)) throw new Error('fresh lease is not exact detached clean pinned state');
        const activated = activateScenario(
          repository, leaseRoot, frozenCollection, preparedAuthority.scenario,
        );
        active = {
          handle, leaseRoot, leaseMarker, repository,
          activeRepository: activated.activeRepository,
          worktreeRole: activated.worktreeRole,
          proof: activated.proof,
          scenario: preparedAuthority.scenario,
          collection: frozenCollection,
          expectedState: frozenClone(expectedState),
          base: preparedAuthority.base,
          copiedPack: closure,
          linkedAdmin: null,
        };
        verifyScenarioActive(active);
        validateLeaseMarker(leaseRoot, leaseMarker);
        active.activeSnapshot = scanTree(leaseRoot, {
          maximumFiles: maximumSnapshotFiles, maximumBytes: maximumSnapshotBytes,
        });
      } catch (error) {
        active = null;
        try {
          if (fs.existsSync(leaseRoot)) {
            const leaseParent = physicalDirectory(leases, 'failed physical lease parent');
            terminalDisposition = quarantineExactOwnedDirectory(
              leaseRoot, leaseParent, leaseMarker.identity, leaseMarker,
              'failed physical repository lease', `.lamina-lease-quarantine-${handle}`,
              syntheticLifecycleInterposition,
            );
          }
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError],
            'lease creation failed and quarantine disposition could not be authenticated');
        }
        throw new AggregateError([error],
          'lease creation failed; quarantine awaits supervisor cleanup');
      }
      return frozenClone({
        schema: 'lamina.materialized-repository-lease/v1',
        opaque_handle: handle,
        provenance_digest: base.provenance_digest,
        start_digest: base.content_digest,
      });
    },

    resolve(lease) {
      requireOpen();
      const handle = typeof lease === 'string' ? lease : lease?.opaque_handle;
      if (!active || active.handle !== handle) throw new Error('repository lease handle is unknown or no longer active');
      validateLeaseMarker(active.leaseRoot, active.leaseMarker);
      return frozenClone({ repository: active.activeRepository, worktree_role: active.worktreeRole });
    },

    async verifyAndRelease(lease) {
      requireOpen();
      if (!active || active.handle !== lease?.opaque_handle) {
        throw new Error('repository lease handle is unknown or already released');
      }
      validateLeaseMarker(active.leaseRoot, active.leaseMarker);
      verifyScenarioActive(active);
      const beforeRelease = scanTree(active.leaseRoot, {
        maximumFiles: maximumSnapshotFiles, maximumBytes: maximumSnapshotBytes,
      });
      if (beforeRelease.digest !== active.activeSnapshot.digest) {
        throw new Error('candidate changed the physical lease beyond the reviewed scenario');
      }
      const actualCache = scanTree(cache, {
        maximumFiles: maximumSnapshotFiles, maximumBytes: maximumSnapshotBytes,
      });
      if (actualCache.digest !== cacheSnapshot.digest) throw new Error('candidate changed the packed bare cache');
      deactivateScenario(active);
      const releasedRoot = active.leaseRoot;
      const leaseParent = physicalDirectory(leases, 'physical repository lease parent');
      const disposition = quarantineExactOwnedDirectory(
        releasedRoot, leaseParent, active.leaseMarker.identity,
        active.leaseMarker, 'physical repository lease',
        `.lamina-lease-quarantine-${active.handle}`, syntheticLifecycleInterposition);
      active.cleanupDisposition = disposition;
      terminalDisposition = disposition;
      const result = {
        end_digest: active.base.content_digest,
        cleanup_verified: false,
        terminal_disposition: disposition.terminal_disposition,
        quarantine: disposition.quarantine,
      };
      return frozenClone(result);
    },

    recoveryAuthority() {
      if (closed) throw new Error('persistent materializer is closed');
      return recoveryAuthorityFromMarker(marker);
    },

    cleanupDisposition() {
      return terminalDisposition ? frozenClone(terminalDisposition) : null;
    },

    async close() {
      requireOpen();
      if (active) throw new Error('cannot close persistent materializer with an active lease');
      if (fs.readdirSync(leases).length !== 0) throw new Error('released lease paths remain before close');
      const disposition = removeExactOwnedRoot(root, marker, syntheticLifecycleInterposition);
      terminalDisposition = disposition;
      OWNED_GIT_ROOTS.delete(root);
      closed = true;
      return frozenClone(disposition);
    },

    inspectForTest() {
      requireOpen();
      return frozenClone({
        root, cache, leases, active_count: active ? 1 : 0,
        active_handle: active?.handle || null,
        active_lease_root: active?.leaseRoot || null,
        active_repository: active?.activeRepository || null,
        cache_pack_files: packClosure(cache, maximumPackBytes).records.map((item) => item.name),
        cache_digest: cacheSnapshot.digest,
      });
    },
  };
  return Object.freeze(api);
}

export function createPersistentScenarioMaterializer(options) {
  for (const syntheticOnly of [
    'seedBareRepository', 'syntheticCopyInterposition', 'syntheticLifecycleInterposition',
  ]) {
    if (options && syntheticOnly in Object(options) && !Object.hasOwn(options, syntheticOnly)) {
      throw new Error('production persistent materializer rejects inherited synthetic-only authority');
    }
  }
  const sanitized = exactOptions(options, new Set([
    'runnerTemporaryRoot', 'collection', 'recoveryOwnerIdentity', 'publishRecoveryAuthority',
    'maximumPackBytes', 'maximumSnapshotFiles', 'maximumSnapshotBytes',
  ]), ['runnerTemporaryRoot', 'collection', 'recoveryOwnerIdentity', 'publishRecoveryAuthority'],
  'production persistent materializer');
  const reviewed = loadReviewedFixture().fixture.collections;
  if (!reviewed.some((collection) => same(collection, sanitized.collection))) {
    throw new Error('production persistent materializer collection is not an exact reviewed fixture pin');
  }
  return createPersistentScenarioMaterializerInternal(sanitized);
}

export const SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY = Symbol(
  'synthetic persistent materializer test authority',
);

export function createSyntheticPersistentScenarioMaterializer(options, authority) {
  if (authority !== SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY) {
    throw new Error('synthetic persistent materializer requires explicit test-only authority and seed');
  }
  const sanitized = exactOptions(options, new Set([
    'runnerTemporaryRoot', 'collection', 'recoveryOwnerIdentity', 'publishRecoveryAuthority',
    'seedBareRepository', 'maximumPackBytes', 'maximumSnapshotFiles', 'maximumSnapshotBytes',
    'syntheticCopyInterposition', 'syntheticLifecycleInterposition',
  ]), [
    'runnerTemporaryRoot', 'collection', 'recoveryOwnerIdentity', 'publishRecoveryAuthority',
    'seedBareRepository',
  ], 'synthetic persistent materializer');
  if (!sanitized.seedBareRepository
    || (sanitized.syntheticCopyInterposition !== undefined
      && typeof sanitized.syntheticCopyInterposition !== 'function')
    || (sanitized.syntheticLifecycleInterposition !== undefined
      && typeof sanitized.syntheticLifecycleInterposition !== 'function')) {
    throw new Error('synthetic persistent materializer requires explicit test-only authority and seed');
  }
  return createPersistentScenarioMaterializerInternal(sanitized);
}

function assertRecoveryAuthority(authority) {
  const initialKeys = [
    'authority_token', 'parent_identity', 'recovery_owner_identity',
    'root', 'schema',
  ];
  const finalKeys = [...initialKeys, 'root_identity'];
  const actualKeys = authority && typeof authority === 'object'
    ? Object.keys(authority).sort() : [];
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)
    || (![initialKeys, finalKeys].some((keys) =>
      JSON.stringify(actualKeys) === JSON.stringify(keys.sort())))
    || authority.schema !== PERSISTENT_MATERIALIZER_RECOVERY_SCHEMA
    || !path.isAbsolute(authority.root || '')
    || !/^[a-f0-9]{64}$/.test(authority.authority_token || '')
    || (Object.hasOwn(authority, 'root_identity')
      && (JSON.stringify(Object.keys(authority.root_identity || {}).sort())
          !== JSON.stringify(['dev', 'ino', 'path', 'uid'])
        || authority.root_identity.path !== authority.root
        || !/^\d+$/.test(String(authority.root_identity.dev))
        || !/^\d+$/.test(String(authority.root_identity.ino))
        || !Number.isSafeInteger(authority.root_identity.uid)
        || authority.root_identity.uid < 0))
    || !validOwnerIdentity(authority.recovery_owner_identity)) {
    throw new Error('persistent materializer recovery requires exact authorized owner-death evidence');
  }
}

function discoverRecoveryRoot(parent, authority) {
  const matches = [];
  const pending = [parent.path];
  const visited = new Set([`${parent.dev}:${parent.ino}`]);
  let discoveredEntries = 0;
  while (pending.length) {
    const directory = pending.pop();
    const names = fs.readdirSync(directory);
    discoveredEntries += names.length;
    if (discoveredEntries > DEFAULT_MAX_SNAPSHOT_FILES) {
      throw new Error('persistent materializer recovery parent exceeds its discovery bound');
    }
    for (const name of names) {
      const candidate = path.join(directory, name);
      let stat;
      try { stat = fs.lstatSync(candidate, { bigint: true }); } catch { continue; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const identity = `${stat.dev}:${stat.ino}`;
      if (String(stat.dev) === String(authority.root_identity.dev)
        && String(stat.ino) === String(authority.root_identity.ino)
        && Number(stat.uid) === Number(authority.root_identity.uid)) {
        matches.push(candidate);
      } else if (!visited.has(identity)) {
        visited.add(identity);
        pending.push(candidate);
      }
    }
  }
  if (matches.length > 1) {
    throw new Error('persistent materializer recovery has ambiguous owned-root locations');
  }
  if (matches.length === 0) return null;
  const descriptor = openAuthenticatedDirectory(
    matches[0], authority.root_identity, 'discovered persistent materializer root',
  );
  try {
    const marker = readMarkerFromDirectoryDescriptor(
      descriptor, 'discovered persistent materializer root',
    );
    if (marker.authority_token !== authority.authority_token
      || !same(marker.recovery_owner_identity, authority.recovery_owner_identity)
      || !same(marker.parent_identity, authority.parent_identity)
      || !same(marker.root_identity, authority.root_identity)) {
      throw new Error('persistent materializer recovery marker was substituted');
    }
  } finally { fs.closeSync(descriptor); }
  return matches[0];
}

function assertRecoveryOwnerDead(identity) {
  let processExists = false;
  try {
    process.kill(identity.pid, 0);
    processExists = true;
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw new Error('persistent materializer recovery owner liveness is unknown');
    }
  }
  const currentOwner = processIdentity(identity.pid);
  if (processExists && !currentOwner) {
    throw new Error('persistent materializer recovery owner liveness is unknown');
  }
  if (currentOwner?.start_ticks === identity.start_ticks) {
    throw new Error('persistent materializer recovery owner process is still alive');
  }
}

function pathPresent(candidate) {
  try { fs.lstatSync(candidate); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function validateRecoveryEnvelope(actualRoot, authority) {
  const { marker } = validateRootEnvelope(actualRoot, authority.root);
  if (marker.authority_token !== authority.authority_token
    || !same(marker.recovery_owner_identity, authority.recovery_owner_identity)
    || !same(marker.parent_identity, authority.parent_identity)) {
    throw new Error('persistent materializer recovery marker was substituted');
  }
  return { marker };
}

function strictRecoveryTree(actualRoot) {
  const allowed = new Set([OWNER_FILE, CACHE_NAME, LEASES_NAME]);
  const foreign = fs.readdirSync(actualRoot).filter((name) => !allowed.has(name));
  if (foreign.length) throw new Error('persistent materializer root contains foreign entries');
  physicalDirectory(path.join(actualRoot, CACHE_NAME), 'persistent materializer cache');
  physicalDirectory(path.join(actualRoot, LEASES_NAME), 'persistent materializer leases');
  scanTree(actualRoot);
}

function removeAlreadyQuarantinedRoot(quarantine, authority, marker) {
  const parent = physicalDirectory(path.dirname(authority.root),
    'persistent materializer recovery parent');
  const before = physicalDirectory(quarantine, 'persistent materializer root quarantine');
  const actualMarker = readExactJson(path.join(quarantine, OWNER_FILE),
    'persistent materializer root quarantine marker');
  if (!sameIdentity(parent, authority.parent_identity)
    || !quarantine.startsWith(`${parent.path}${path.sep}`)
    || !sameNodeIdentity(before, marker.root_identity) || !same(actualMarker, marker)) {
    throw new Error('persistent materializer root quarantine authority changed');
  }
  const descriptor = openAuthenticatedDirectory(
    quarantine, marker.root_identity, 'persistent materializer root quarantine',
  );
  try {
    if (!same(readMarkerFromDirectoryDescriptor(
      descriptor, 'persistent materializer root quarantine',
    ), marker)) throw new Error('persistent materializer root quarantine marker changed');
    return Object.freeze({
      recovered: false,
      cleanup_verified: false,
      root_path_absent: true,
      terminal_disposition: 'awaiting_supervisor_cleanup',
      quarantine,
      foreign_content_preserved: false,
    });
  } finally { fs.closeSync(descriptor); }
}

function quarantineContaminatedRoot(actualRoot, authority, marker) {
  const parent = physicalDirectory(path.dirname(authority.root),
    'persistent materializer recovery parent');
  const before = physicalDirectory(actualRoot, 'contaminated persistent materializer root');
  const quarantine = path.join(parent.path,
    `${CONTAMINATED_QUARANTINE_PREFIX}${authority.authority_token}`);
  if (!sameIdentity(parent, authority.parent_identity)
    || !actualRoot.startsWith(`${parent.path}${path.sep}`)
    || !sameNodeIdentity(before, marker.root_identity)) {
    throw new Error('contaminated persistent materializer identity changed');
  }
  assertAbsent(quarantine, 'contaminated persistent materializer quarantine destination');
  fs.renameSync(actualRoot, quarantine);
  assertAbsent(actualRoot, 'contaminated persistent materializer root');
  const after = physicalDirectory(quarantine, 'contaminated persistent materializer quarantine');
  const actualMarker = readExactJson(path.join(quarantine, OWNER_FILE),
    'contaminated persistent materializer marker');
  if (!sameNodeIdentity(after, marker.root_identity) || !same(actualMarker, marker)
    || !sameIdentity(physicalDirectory(parent.path,
      'contaminated persistent materializer parent'), authority.parent_identity)) {
    throw new Error('contaminated persistent materializer was substituted during quarantine');
  }
  return Object.freeze({
    recovered: false,
    cleanup_verified: false,
    root_path_absent: true,
    terminal_disposition: 'contaminated_quarantine',
    quarantine,
    foreign_content_preserved: true,
  });
}

export function recoverPersistentScenarioMaterializer(authority) {
  if (process.platform !== 'linux') {
    throw new Error('persistent materializer recovery requires Linux host process evidence');
  }
  assertRecoveryAuthority(authority);
  const parent = physicalDirectory(path.dirname(authority.root), 'safe-runner recovery parent');
  if (!sameIdentity(parent, authority.parent_identity)) {
    throw new Error('persistent materializer recovery parent authority changed');
  }
  const normalQuarantine = path.join(parent.path,
    `${ROOT_QUARANTINE_PREFIX}${authority.authority_token}`);
  const contaminatedQuarantine = path.join(parent.path,
    `${CONTAMINATED_QUARANTINE_PREFIX}${authority.authority_token}`);
  const hasFinalAuthority = Object.hasOwn(authority, 'root_identity');
  const locations = hasFinalAuthority
    ? [discoverRecoveryRoot(parent, authority)].filter(Boolean)
    : [authority.root, normalQuarantine, contaminatedQuarantine].filter(pathPresent);
  if (locations.length === 0) {
    assertRecoveryOwnerDead(authority.recovery_owner_identity);
    return Object.freeze({
      recovered: false, cleanup_verified: false,
      terminal_disposition: hasFinalAuthority
        ? 'owned_quarantine_path_lost' : 'no_root_created',
      intended_root: authority.root,
      ...(hasFinalAuthority ? { owned_identity: frozenClone(authority.root_identity) } : {}),
    });
  }
  if (locations.length !== 1) {
    throw new Error('persistent materializer recovery has ambiguous owned-root locations');
  }
  const actualRoot = locations[0];
  if (actualRoot === authority.root && !pathPresent(path.join(actualRoot, OWNER_FILE))) {
    physicalDirectory(actualRoot, 'unmarked intended persistent materializer root');
    assertRecoveryOwnerDead(authority.recovery_owner_identity);
    return Object.freeze({
      recovered: false, cleanup_verified: false,
      terminal_disposition: 'unverified_intended_root', intended_root: authority.root,
    });
  }
  const { marker } = validateRecoveryEnvelope(actualRoot, authority);
  assertRecoveryOwnerDead(authority.recovery_owner_identity);
  if (actualRoot === contaminatedQuarantine) {
    return Object.freeze({
      recovered: false, cleanup_verified: false, root_path_absent: true,
      terminal_disposition: 'contaminated_quarantine', quarantine: contaminatedQuarantine,
      foreign_content_preserved: true,
    });
  }
  try {
    strictRecoveryTree(actualRoot);
  } catch {
    return quarantineContaminatedRoot(actualRoot, authority, marker);
  }
  if (actualRoot !== authority.root) {
    return removeAlreadyQuarantinedRoot(actualRoot, authority, marker);
  } else {
    const disposition = removeExactOwnedRoot(actualRoot, marker);
    return Object.freeze({
      recovered: false,
      cleanup_verified: false,
      root_path_absent: true,
      terminal_disposition: disposition.terminal_disposition,
      quarantine: disposition.quarantine,
      foreign_content_preserved: false,
    });
  }
}
