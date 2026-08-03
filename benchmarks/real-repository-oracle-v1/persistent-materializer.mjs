import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnTrustedGit } from '../../scripts/safe-runner/git.mjs';
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

const OWNER_FILE = '.owner.json';
const ROOT_PREFIX = 'real-repository-oracle-materializer-';
const CACHE_NAME = 'cache.git';
const LEASES_NAME = 'leases';
const MAX_GIT_OUTPUT = 8 * 1024 * 1024;
const MAX_PACK_FILES = 3;
const DEFAULT_MAX_PACK_BYTES = 768 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_FILES = 120_000;
const DEFAULT_MAX_SNAPSHOT_BYTES = 768 * 1024 * 1024;
const HANDLE = /^[a-f0-9]{64}$/;
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

function checkedGit(cwd, args, timeout = 60_000) {
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

function writeOwnerMarker(root, parentIdentity) {
  const rootIdentity = physicalDirectory(root, 'persistent materializer root');
  const marker = {
    schema: PERSISTENT_MATERIALIZER_SCHEMA,
    root,
    root_identity: rootIdentity,
    parent_identity: parentIdentity,
    owner_pid: process.pid,
    authority_token: crypto.randomBytes(32).toString('hex'),
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
    || !Number.isSafeInteger(marker.owner_pid) || marker.owner_pid < 1
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
  if (names.length < 2 || names.length > MAX_PACK_FILES) {
    throw new Error('packed object cache must contain one pack, one index, and at most one reverse index');
  }
  const pack = names.find((name) => /^pack-[a-f0-9]{40,64}\.pack$/.test(name));
  const index = names.find((name) => /^pack-[a-f0-9]{40,64}\.idx$/.test(name));
  const reverse = names.find((name) => /^pack-[a-f0-9]{40,64}\.rev$/.test(name));
  const base = pack?.slice(0, -5);
  if (!pack || !index || base !== index.slice(0, -4)
    || (reverse && base !== reverse.slice(0, -4))
    || names.some((name) => ![pack, index, reverse].includes(name))) {
    throw new Error('packed object cache has foreign suffixes or mismatched companions');
  }
  let total = 0;
  const records = [pack, index, ...(reverse ? [reverse] : [])].map((name) => {
    const file = path.join(packDirectory, name);
    const stat = physicalFile(file, `packed object cache ${name}`, maximumPackBytes);
    total += Number(stat.size);
    if (total > maximumPackBytes) throw new Error('packed object cache exceeds its byte bound');
    return Object.freeze({ name, file, size: Number(stat.size), sha256: sha256(fs.readFileSync(file)), stat });
  });
  return Object.freeze({ packDirectory, total_bytes: total, records });
}

function copyPhysicalFile(source, destination, expected, maximumBytes) {
  const before = physicalFile(source, 'packed cache source', maximumBytes);
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
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

function copyPackedClosure(sourceRepository, destinationRepository, maximumPackBytes) {
  const source = packClosure(sourceRepository, maximumPackBytes);
  const destinationPack = path.join(destinationRepository, 'objects', 'pack');
  for (const record of source.records) {
    copyPhysicalFile(record.file, path.join(destinationPack, record.name), record, maximumPackBytes);
  }
  const shallowSource = path.join(sourceRepository, 'shallow');
  if (fs.existsSync(shallowSource)) {
    const stat = physicalFile(shallowSource, 'packed cache shallow boundary', 1024 * 1024);
    const expected = { size: Number(stat.size), sha256: sha256(fs.readFileSync(shallowSource)) };
    copyPhysicalFile(shallowSource, path.join(destinationRepository, 'shallow'), expected, 1024 * 1024);
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

function makeOwnerWritable(root) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('owned cleanup encountered a symlink');
    if (stat.isDirectory()) {
      fs.chmodSync(current, 0o700);
      for (const name of fs.readdirSync(current)) pending.push(path.join(current, name));
    } else if (stat.isFile()) fs.chmodSync(current, 0o600);
    else throw new Error('owned cleanup encountered a special path');
  }
}

function verifyPin(repository, collection) {
  const commit = checkedGit(repository, ['rev-parse', '--verify', `${collection.commit}^{commit}`]).trim();
  const tree = checkedGit(repository, ['rev-parse', '--verify', `${collection.commit}^{tree}`]).trim();
  if (commit !== collection.commit || tree !== collection.tree_oid) {
    throw new Error('packed object closure does not resolve the exact reviewed commit and tree');
  }
  checkedGit(repository, ['fsck', '--full', '--strict', '--no-reflogs', collection.commit], 120_000);
}

function initializeCache(cache, collection, seedBareRepository, maximumPackBytes) {
  checkedGit(path.dirname(cache), ['init', '--quiet', '--bare', cache]);
  if (seedBareRepository) {
    const seed = physicalDirectory(seedBareRepository,
      'synthetic packed bare cache seed', { privateMode: false }).path;
    copyPackedClosure(seed, cache, maximumPackBytes);
    checkedGit(cache, ['update-ref', 'refs/lamina/cache-pin', collection.commit]);
  } else {
    checkedGit(cache, [
      'fetch', '--quiet', '--no-tags', '--depth=1', collection.repository_url,
      `+${collection.commit}:refs/lamina/cache-pin`,
    ], 20 * 60_000);
    checkedGit(cache, ['repack', '-Ad', '--no-write-bitmap-index'], 20 * 60_000);
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

function removeExactOwnedRoot(root, marker) {
  validateRoot(root, marker);
  scanTree(root);
  makeOwnerWritable(root);
  fs.rmSync(root, { recursive: true, force: false });
  assertAbsent(root, 'persistent materializer root');
}

export function createPersistentScenarioMaterializer({
  runnerTemporaryRoot,
  collection,
  seedBareRepository = null,
  maximumPackBytes = DEFAULT_MAX_PACK_BYTES,
  maximumSnapshotFiles = DEFAULT_MAX_SNAPSHOT_FILES,
  maximumSnapshotBytes = DEFAULT_MAX_SNAPSHOT_BYTES,
}) {
  if (process.platform === 'win32') {
    throw new Error('persistent materializer requires POSIX physical ownership semantics');
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
  const root = fs.mkdtempSync(path.join(parentIdentity.path, ROOT_PREFIX));
  fs.chmodSync(root, 0o700);
  const cache = path.join(root, CACHE_NAME);
  const leases = path.join(root, LEASES_NAME);
  fs.mkdirSync(cache, { mode: 0o700 });
  fs.rmdirSync(cache);
  fs.mkdirSync(leases, { mode: 0o700 });
  const marker = writeOwnerMarker(root, parentIdentity);
  const frozenCollection = frozenClone(collection);
  let cacheSnapshot;
  try {
    initializeCache(cache, frozenCollection, physicalSeed, maximumPackBytes);
    cacheSnapshot = scanTree(cache, {
      maximumFiles: maximumSnapshotFiles, maximumBytes: maximumSnapshotBytes,
    });
    validateRoot(root, marker);
  } catch (error) {
    try {
      if (fs.existsSync(root)) {
        makeOwnerWritable(root);
        fs.rmSync(root, { recursive: true, force: false });
      }
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'materializer creation and cleanup both failed');
    }
    throw error;
  }

  const prepared = new Map();
  const issued = new Set();
  let active = null;
  let closed = false;

  const requireOpen = () => {
    if (closed) throw new Error('persistent materializer is closed');
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
          if (fs.existsSync(leaseRoot)) fs.rmSync(leaseRoot, { recursive: true, force: false });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'lease creation and cleanup both failed');
        }
        throw error;
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
      fs.rmSync(releasedRoot, { recursive: true, force: false });
      assertAbsent(releasedRoot, 'physical repository lease');
      const result = {
        end_digest: active.base.content_digest,
        cleanup_verified: true,
      };
      active = null;
      return frozenClone(result);
    },

    recoveryAuthority() {
      if (closed) throw new Error('persistent materializer is closed');
      return frozenClone({
        schema: PERSISTENT_MATERIALIZER_RECOVERY_SCHEMA,
        root,
        root_identity: marker.root_identity,
        parent_identity: marker.parent_identity,
        authority_token: marker.authority_token,
        owner_pid: marker.owner_pid,
      });
    },

    async close() {
      requireOpen();
      if (active) throw new Error('cannot close persistent materializer with an active lease');
      if (fs.readdirSync(leases).length !== 0) throw new Error('released lease paths remain before close');
      removeExactOwnedRoot(root, marker);
      closed = true;
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

export function recoverPersistentScenarioMaterializer(authority, { ownerDead = false } = {}) {
  if (!ownerDead || authority?.schema !== PERSISTENT_MATERIALIZER_RECOVERY_SCHEMA
    || !path.isAbsolute(authority.root || '') || !/^[a-f0-9]{64}$/.test(authority.authority_token || '')
    || !Number.isSafeInteger(authority.owner_pid) || authority.owner_pid < 1) {
    throw new Error('persistent materializer recovery requires exact authorized owner-death evidence');
  }
  const parent = physicalDirectory(path.dirname(authority.root), 'safe-runner recovery parent');
  if (!sameIdentity(parent, authority.parent_identity)) {
    throw new Error('persistent materializer recovery parent authority changed');
  }
  const marker = validateRoot(authority.root);
  if (!sameIdentity(marker.root_identity, authority.root_identity)
    || marker.authority_token !== authority.authority_token
    || marker.owner_pid !== authority.owner_pid) {
    throw new Error('persistent materializer recovery marker was substituted');
  }
  scanTree(authority.root);
  removeExactOwnedRoot(authority.root, marker);
  return Object.freeze({ recovered: true, root_removed: true });
}
