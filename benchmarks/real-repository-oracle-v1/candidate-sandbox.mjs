import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  assertTrustedBinaryIdentity,
  trustedRootHostBinary,
} from '../../scripts/safe-runner/infrastructure.mjs';
import {
  descendantRecords,
  identityAlive,
  processIdentity,
} from '../../scripts/safe-runner/processes.mjs';
import { verifyCandidateRuntimeSnapshot } from './candidate-runtime-closure.mjs';

export const CANDIDATE_SANDBOX_AUTHORITY_SCHEMA =
  'lamina.real-repository-oracle-candidate-sandbox-authority/v1';
export const CANDIDATE_SANDBOX_LIMITATION =
  'pending_issue_59_same_cgroup_supervision_and_physical_cleanup_proof_not_implemented';
export const CANDIDATE_SOURCE_SNAPSHOT_LIMITATION =
  'pending_issue_59_private_host_mount_namespace_for_atomic_same_uid_source_snapshot_not_implemented';
export const CANDIDATE_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;
export const CANDIDATE_ROOT_MAX_BYTES = 1024 * 1024;
export const CANDIDATE_DEV_SHM_MAX_BYTES = 4 * 1024;
export const CANDIDATE_MOUNT_FD_MAX = 48;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_TREE_FILES = 120_000;
const MAX_TREE_BYTES = 768 * 1024 * 1024;
const AUTHORITY_STATES = new WeakMap();

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => sha256(Buffer.from(JSON.stringify(canonical(value))));
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function attestBubblewrapReadOnlyRemount(identity) {
  assertTrustedBinaryIdentity(identity);
  const help = spawnSync(identity.path, ['--help'], {
    encoding: 'utf8', timeout: 2_000, maxBuffer: 256 * 1024,
    env: { LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assertTrustedBinaryIdentity(identity);
  const requiredOptions = Object.freeze([
    '--remount-ro DEST', '--bind-fd FD DEST', '--ro-bind-fd FD DEST',
    '--disable-userns', '--assert-userns-disabled', '--size BYTES', '--proc DEST', '--dev DEST',
  ]);
  const advertised = requiredOptions.every((option) => {
    const pattern = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    return new RegExp(`^\\s*${pattern}(?:\\s|$)`, 'm').test(help.stdout);
  });
  if (help.error || help.status !== 0 || help.signal || help.stderr.trim() || !advertised) {
    const error = new Error('candidate sandbox requires attested bubblewrap isolation options');
    error.code = 'LAMINA_CANDIDATE_SANDBOX_UNSUPPORTED';
    throw error;
  }
  return freeze({
    read_only_remount: true,
    required_options: requiredOptions,
    help_sha256: sha256(Buffer.from(help.stdout)),
  });
}

function physicalDirectory(candidate, label, { privateMode = false } = {}) {
  const absolute = path.resolve(String(candidate || ''));
  const stat = fs.lstatSync(absolute, { bigint: true });
  if (!path.isAbsolute(String(candidate || '')) || absolute !== candidate
    || fs.realpathSync.native(absolute) !== absolute || !stat.isDirectory()
    || stat.isSymbolicLink() || (process.platform !== 'win32'
      && (stat.uid !== BigInt(process.getuid()) || (privateMode && (stat.mode & 0o077n) !== 0n)))) {
    throw new Error(`${label} must be an exact physical directory`);
  }
  return {
    path: absolute,
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: Number(stat.uid),
    nlink: String(stat.nlink),
    mode: Number(stat.mode & 0o7777n),
  };
}

function physicalFile(candidate, label, { empty = false } = {}) {
  const absolute = path.resolve(String(candidate || ''));
  const stat = fs.lstatSync(absolute, { bigint: true });
  if (!path.isAbsolute(String(candidate || '')) || absolute !== candidate
    || fs.realpathSync.native(absolute) !== absolute || !stat.isFile()
    || stat.isSymbolicLink() || stat.nlink !== 1n
    || stat.size > BigInt(CANDIDATE_OUTPUT_MAX_BYTES)
    || (empty && stat.size !== 0n)
    || (process.platform !== 'win32' && stat.uid !== BigInt(process.getuid()))) {
    throw new Error(`${label} must be a bounded physical single-link file`);
  }
  const bytes = fs.readFileSync(absolute);
  return {
    path: absolute, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
    nlink: String(stat.nlink), mode: Number(stat.mode & 0o7777n),
    size: bytes.length, sha256: sha256(bytes),
  };
}

function treeIdentity(root, label, { allowSymlinks = true } = {}) {
  const rootIdentity = physicalDirectory(root, label);
  const pending = [{ absolute: root, relative: '' }];
  const records = [];
  let bytes = 0;
  while (pending.length) {
    const current = pending.pop();
    for (const name of fs.readdirSync(current.absolute).sort().reverse()) {
      const absolute = path.join(current.absolute, name);
      const relative = path.posix.join(current.relative.split(path.sep).join('/'), name);
      const stat = fs.lstatSync(absolute, { bigint: true });
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        records.push({
          path: relative, type: 'directory', dev: String(stat.dev), ino: String(stat.ino),
          uid: Number(stat.uid), nlink: String(stat.nlink), mode: Number(stat.mode & 0o7777n),
        });
        pending.push({ absolute, relative });
      } else if (stat.isFile() && !stat.isSymbolicLink()) {
        if (stat.nlink !== 1n) throw new Error(`${label} contains a hard-linked file`);
        const content = fs.readFileSync(absolute);
        bytes += content.length;
        records.push({
          path: relative, type: 'file', dev: String(stat.dev), ino: String(stat.ino),
          uid: Number(stat.uid), nlink: String(stat.nlink), mode: Number(stat.mode & 0o7777n),
          bytes: content.length, sha256: sha256(content),
        });
      } else if (stat.isSymbolicLink() && allowSymlinks) {
        if (stat.nlink !== 1n) throw new Error(`${label} contains a hard-linked symbolic link`);
        records.push({
          path: relative, type: 'symlink', dev: String(stat.dev), ino: String(stat.ino),
          uid: Number(stat.uid), nlink: String(stat.nlink), mode: Number(stat.mode & 0o7777n),
          target: fs.readlinkSync(absolute),
        });
      } else throw new Error(`${label} contains unsupported filesystem content`);
      if (records.length > MAX_TREE_FILES || bytes > MAX_TREE_BYTES) {
        throw new Error(`${label} exceeds bounded identity limits`);
      }
    }
  }
  records.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return freeze({
    root_identity: rootIdentity,
    files: records.length,
    bytes,
    records,
    sha256: digest(records),
  });
}

function canonicalInputIdentity(file) {
  const identity = physicalFile(file, 'candidate public input');
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('candidate public input must be canonical JSON'); }
  const expected = Buffer.from(JSON.stringify(canonical(value)));
  const actual = fs.readFileSync(file);
  if (!actual.equals(expected)) throw new Error('candidate public input bytes are not canonical JSON');
  return identity;
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)
    || value.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} must be an exact safe relative path`);
  }
  return value.split(path.sep).join('/');
}

function buildMountPlan({
  runtime, adapterRoot, adapter, publicInput, inputIdentity, repository,
  repositoryIdentity, outputFile, outputIdentity,
}) {
  const entries = [];
  for (const mount of runtime.mounts) {
    const record = runtime.records.find((item) => item.name === mount.snapshot_name);
    if (!record) throw new Error('candidate runtime mount lacks an exact snapshot record');
    entries.push({
      kind: 'runtime-file', source: path.join(runtime.root, mount.snapshot_name),
      destination: mount.destination, directory: false, writable: false,
      identity: record,
    });
  }
  for (const record of adapter.records.filter((item) => item.type === 'file')) {
    entries.push({
      kind: 'adapter-file',
      source: path.join(adapterRoot, ...record.path.split('/')),
      destination: `/candidate/${record.path}`,
      directory: false,
      writable: false,
      identity: record,
    });
  }
  entries.push(
    {
      kind: 'public-input', source: publicInput, destination: '/input/public.json',
      directory: false, writable: false, identity: inputIdentity,
    },
    {
      kind: 'repository', source: repository, destination: '/repository',
      directory: true, writable: false, identity: repositoryIdentity.root_identity,
    },
    {
      kind: 'output', source: outputFile, destination: '/output/result',
      directory: false, writable: true, identity: outputIdentity,
    },
  );
  if (entries.length > CANDIDATE_MOUNT_FD_MAX) {
    throw new Error(`candidate exact mount closure exceeds ${CANDIDATE_MOUNT_FD_MAX} descriptors`);
  }
  entries.forEach((entry, index) => { entry.fd = index + 3; });
  return {
    entries,
    runtime_directories: [...new Set(runtime.mounts.flatMap((mount) => {
      const directories = [];
      let current = path.posix.dirname(mount.destination);
      while (current !== '/' && current !== '/runtime') {
        directories.push(current);
        current = path.posix.dirname(current);
      }
      return directories;
    }))],
    adapter_directories: adapter.records.filter((item) => item.type === 'directory')
      .map((item) => item.path),
  };
}

export function candidateBubblewrapArguments({
  mount_plan: mountPlan,
  adapter_entrypoint: adapterEntrypoint,
  platform = process.platform,
} = {}) {
  if (platform !== 'linux') throw new Error('candidate sandbox execution requires Linux');
  const entrypoint = safeRelative(adapterEntrypoint, 'candidate adapter entrypoint');
  if (!mountPlan || !Array.isArray(mountPlan.entries)
    || !Array.isArray(mountPlan.runtime_directories)
    || !Array.isArray(mountPlan.adapter_directories)
    || mountPlan.entries.length < 5 || mountPlan.entries.length > CANDIDATE_MOUNT_FD_MAX) {
    throw new Error('candidate exact mount plan is invalid');
  }
  const destinations = new Set();
  for (const [index, entry] of mountPlan.entries.entries()) {
    if (entry.fd !== index + 3 || entry.fd > 63 || typeof entry.destination !== 'string'
      || !entry.destination.startsWith('/') || path.posix.normalize(entry.destination) !== entry.destination
      || destinations.has(entry.destination)) throw new Error('candidate exact mount entry is invalid');
    destinations.add(entry.destination);
  }
  if (!destinations.has('/runtime/node') || !destinations.has('/runtime/loader')
    || !destinations.has(`/candidate/${entrypoint}`)
    || !destinations.has('/input/public.json') || !destinations.has('/repository')
    || !destinations.has('/output/result')) {
    throw new Error('candidate exact mount plan lacks a required target');
  }
  const adapterDirectories = mountPlan.adapter_directories.map((directory) =>
    safeRelative(directory, 'candidate adapter directory'))
    .sort((left, right) => left.split('/').length - right.split('/').length
      || left.localeCompare(right));
  const runtimeDirectories = [...mountPlan.runtime_directories]
    .sort((left, right) => left.split('/').length - right.split('/').length
      || left.localeCompare(right));
  const args = [
    '--die-with-parent', '--new-session',
    '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-net',
    '--uid', '0', '--gid', '0', '--hostname', 'lamina-candidate',
    '--disable-userns', '--assert-userns-disabled', '--cap-drop', 'ALL', '--clearenv',
    '--perms', '0755', '--size', String(CANDIDATE_ROOT_MAX_BYTES), '--tmpfs', '/',
    '--dir', '/runtime', '--dir', '/candidate', '--dir', '/input',
    '--dir', '/repository', '--dir', '/output',
  ];
  for (const directory of runtimeDirectories) args.push('--dir', directory);
  for (const directory of adapterDirectories) args.push('--dir', `/candidate/${directory}`);
  for (const entry of mountPlan.entries) {
    args.push(entry.writable ? '--bind-fd' : '--ro-bind-fd', String(entry.fd), entry.destination);
  }
  args.push(
    '--proc', '/proc', '--dev', '/dev',
    '--perms', '0555', '--size', String(CANDIDATE_DEV_SHM_MAX_BYTES), '--tmpfs', '/dev/shm',
    '--perms', '0700', '--size', String(CANDIDATE_OUTPUT_MAX_BYTES), '--tmpfs', '/tmp',
    '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'LC_ALL', 'C.UTF-8',
    '--setenv', 'TZ', 'UTC', '--setenv', 'PATH', '/runtime', '--setenv', 'TMPDIR', '/tmp',
    '--remount-ro', '/dev/shm', '--remount-ro', '/dev/pts', '--remount-ro', '/dev',
    '--remount-ro', '/proc', '--remount-ro', '/',
    '--chdir', '/repository',
    '--', '/runtime/loader', '--library-path', '/runtime', '/runtime/node',
    `/candidate/${entrypoint}`, '/input/public.json', '/repository', '/output/result',
  );
  return args;
}

function validateTimeout(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error('candidate sandbox timeout must be between 100 and 60000 milliseconds');
  }
  return timeoutMs;
}

export function prepareCandidateSandbox({
  runtime_snapshot: runtimeSnapshot,
  adapter_root: adapterRoot,
  adapter_entrypoint: adapterEntrypoint,
  public_input: publicInput,
  repository,
  output_file: outputFile,
  timeout_ms: timeoutMs,
  git_dependent: gitDependent = false,
} = {}) {
  if (process.platform !== 'linux') throw new Error('candidate sandbox preparation requires Linux');
  const runtime = verifyCandidateRuntimeSnapshot(runtimeSnapshot);
  const adapterEntry = safeRelative(adapterEntrypoint, 'candidate adapter entrypoint');
  const adapter = treeIdentity(adapterRoot, 'candidate adapter closure', { allowSymlinks: false });
  const adapterEntrypointRecord = adapter.records.find((record) =>
    record.path === adapterEntry && record.type === 'file');
  if (!adapter.files || !adapterEntrypointRecord) {
    throw new Error('candidate adapter entrypoint is absent from its exact closure');
  }
  const repositoryIdentity = treeIdentity(repository, 'candidate repository');
  if (gitDependent === true && fs.existsSync(path.join(repository, '.git'))
    && fs.lstatSync(path.join(repository, '.git')).isFile()) {
    throw new Error('Git-dependent linked-worktree candidate adapters are unsupported');
  }
  if (typeof gitDependent !== 'boolean') throw new Error('candidate git dependency flag is invalid');
  const inputIdentity = canonicalInputIdentity(publicInput);
  const outputIdentity = physicalFile(outputFile, 'candidate output', { empty: true });
  const bwrap = trustedRootHostBinary('bwrap');
  const bwrapCapabilities = attestBubblewrapReadOnlyRemount(bwrap);
  const prlimit = trustedRootHostBinary('prlimit');
  const mountPlan = buildMountPlan({
    runtime,
    adapterRoot,
    adapter,
    publicInput,
    inputIdentity,
    repository,
    repositoryIdentity,
    outputFile,
    outputIdentity,
  });
  const bwrapArguments = candidateBubblewrapArguments({
    mount_plan: mountPlan, adapter_entrypoint: adapterEntry,
  });
  const prlimitArguments = [
    `--fsize=${CANDIDATE_OUTPUT_MAX_BYTES}:${CANDIDATE_OUTPUT_MAX_BYTES}`,
    '--core=0:0', '--nofile=64:64', '--', bwrap.path, ...bwrapArguments,
  ];
  const authority = freeze({
    schema: CANDIDATE_SANDBOX_AUTHORITY_SCHEMA,
    runtime_snapshot: runtime,
    adapter_root: adapterRoot,
    adapter_entrypoint: adapterEntry,
    adapter_identity: adapter,
    public_input: publicInput,
    public_input_identity: inputIdentity,
    repository,
    repository_identity: repositoryIdentity,
    output_file: outputFile,
    output_identity: outputIdentity,
    mount_plan: mountPlan,
    timeout_ms: validateTimeout(timeoutMs),
    git_dependent: gitDependent,
    infrastructure: { bwrap, bwrap_capabilities: bwrapCapabilities, prlimit },
    bwrap_arguments: bwrapArguments,
    prlimit_arguments: prlimitArguments,
    argv_sha256: digest({ executable: prlimit.path, argv: prlimitArguments }),
    environment: {
      LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', PATH: '/runtime', TMPDIR: '/tmp',
      PWD: '/repository',
    },
    limitation: CANDIDATE_SANDBOX_LIMITATION,
    source_snapshot_limitation: CANDIDATE_SOURCE_SNAPSHOT_LIMITATION,
  });
  AUTHORITY_STATES.set(authority, 'prepared');
  return authority;
}

function verifyImmutableAuthorityInputs(authority, phase) {
  verifyCandidateRuntimeSnapshot(authority.runtime_snapshot);
  assertTrustedBinaryIdentity(authority.infrastructure.bwrap);
  assertTrustedBinaryIdentity(authority.infrastructure.prlimit);
  if (!same(treeIdentity(authority.adapter_root, 'candidate adapter closure', { allowSymlinks: false }),
    authority.adapter_identity)
    || !same(treeIdentity(authority.repository, 'candidate repository'), authority.repository_identity)
    || !same(canonicalInputIdentity(authority.public_input), authority.public_input_identity)
    || digest({ executable: authority.infrastructure.prlimit.path, argv: authority.prlimit_arguments })
      !== authority.argv_sha256) {
    throw new Error(`candidate launch authority input identity changed ${phase}`);
  }
}

function verifyAuthority(authority) {
  verifyImmutableAuthorityInputs(authority, 'before launch');
  if (!same(physicalFile(authority.output_file, 'candidate output', { empty: true }),
    authority.output_identity)) {
    throw new Error('candidate launch authority input identity changed before launch');
  }
  return authority;
}

function beginAuthorityLaunch(authority) {
  if (!authority || !AUTHORITY_STATES.has(authority)) {
    throw new Error('candidate launch authority was not issued by this host process');
  }
  const state = AUTHORITY_STATES.get(authority);
  if (state !== 'prepared') {
    throw new Error(`candidate launch authority is ${state} and cannot be reused`);
  }
  AUTHORITY_STATES.set(authority, 'running');
}

function openMount(candidate, directory, expected, writable = false) {
  const descriptor = fs.openSync(candidate, (writable ? fs.constants.O_RDWR : fs.constants.O_RDONLY)
    | fs.constants.O_NOFOLLOW
    | (directory ? fs.constants.O_DIRECTORY : 0));
  const stat = fs.fstatSync(descriptor, { bigint: true });
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink()
    || String(stat.dev) !== String(expected.dev) || String(stat.ino) !== String(expected.ino)
    || Number(stat.uid) !== Number(expected.uid)
    || String(stat.nlink) !== String(expected.nlink)
    || Number(stat.mode & 0o7777n) !== Number(expected.mode)
    || (!directory && stat.nlink !== 1n)) {
    fs.closeSync(descriptor);
    throw new Error('candidate mount descriptor differs from launch authority');
  }
  return descriptor;
}

function descriptorOutputIdentity(descriptor, authority) {
  const expected = authority.output_identity;
  const before = fs.fstatSync(descriptor, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
    || String(before.dev) !== String(expected.dev) || String(before.ino) !== String(expected.ino)
    || Number(before.uid) !== Number(expected.uid)
    || Number(before.mode & 0o7777n) !== Number(expected.mode)
    || before.size > BigInt(CANDIDATE_OUTPUT_MAX_BYTES)) {
    throw new Error('candidate output descriptor identity changed after launch');
  }

  const duplicate = fs.openSync(`/proc/self/fd/${descriptor}`, fs.constants.O_RDONLY);
  const chunks = [];
  let total = 0;
  try {
    const duplicateIdentity = fs.fstatSync(duplicate, { bigint: true });
    if (String(duplicateIdentity.dev) !== String(before.dev)
      || String(duplicateIdentity.ino) !== String(before.ino)) {
      throw new Error('candidate output descriptor duplication changed identity');
    }
    while (total <= CANDIDATE_OUTPUT_MAX_BYTES) {
      const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024,
        CANDIDATE_OUTPUT_MAX_BYTES + 1 - total));
      const bytesRead = fs.readSync(duplicate, chunk, 0, chunk.length, total);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
  } finally {
    fs.closeSync(duplicate);
  }
  if (total > CANDIDATE_OUTPUT_MAX_BYTES) {
    throw new Error('candidate output descriptor exceeds the byte limit');
  }

  const after = fs.fstatSync(descriptor, { bigint: true });
  if (String(after.dev) !== String(before.dev) || String(after.ino) !== String(before.ino)
    || after.nlink !== 1n || after.size !== before.size || Number(after.uid) !== Number(before.uid)
    || Number(after.mode & 0o7777n) !== Number(before.mode & 0o7777n)
    || BigInt(total) !== after.size) {
    throw new Error('candidate output descriptor changed while being observed');
  }

  let pathname;
  try {
    pathname = fs.lstatSync(authority.output_file, { bigint: true });
    if (!pathname.isFile() || pathname.isSymbolicLink() || pathname.nlink !== 1n
      || fs.realpathSync.native(authority.output_file) !== authority.output_file
      || String(pathname.dev) !== String(after.dev) || String(pathname.ino) !== String(after.ino)
      || Number(pathname.uid) !== Number(after.uid)
      || Number(pathname.mode & 0o7777n) !== Number(after.mode & 0o7777n)) {
      throw new Error('mismatch');
    }
  } catch {
    throw new Error('candidate output pathname changed after launch');
  }

  const bytes = Buffer.concat(chunks, total);
  return freeze({
    path: authority.output_file,
    dev: String(after.dev),
    ino: String(after.ino),
    uid: Number(after.uid),
    mode: Number(after.mode & 0o7777n),
    size: total,
    sha256: sha256(bytes),
  });
}

export async function runCandidateSandbox(authority) {
  beginAuthorityLaunch(authority);
  const descriptors = [];
  let child;
  const observed = new Map();
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let timedOut = false;
  let outputFlood = false;
  let stopping = false;
  const remember = () => {
    if (!child?.pid) return;
    const root = processIdentity(child.pid);
    if (root) observed.set(`${root.pid}:${root.start_ticks}`, root);
    for (const record of descendantRecords(child.pid)) {
      const identity = processIdentity(record.pid);
      if (identity) observed.set(`${identity.pid}:${identity.start_ticks}`, identity);
    }
  };
  const stop = () => {
    if (stopping || !child?.pid) return;
    stopping = true;
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 100).unref();
  };
  try {
    if (process.platform !== 'linux') throw new Error('candidate sandbox execution requires Linux');
    verifyAuthority(authority);
    for (const entry of authority.mount_plan.entries) {
      descriptors.push(openMount(entry.source, entry.directory, entry.identity, entry.writable));
    }
    child = spawn(authority.infrastructure.prlimit.path, authority.prlimit_arguments, {
      env: {}, detached: true, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', ...descriptors],
    });
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_CAPTURE_BYTES) {
        outputFlood = true;
        stop();
        return next.subarray(0, MAX_CAPTURE_BYTES);
      }
      return next;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const monitor = setInterval(remember, 20);
    monitor.unref();
    const timeout = setTimeout(() => { timedOut = true; remember(); stop(); }, authority.timeout_ms);
    timeout.unref();
    const ended = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    clearInterval(monitor);
    clearTimeout(timeout);
    remember();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const descendantsRemaining = [...observed.values()].filter(identityAlive);
    verifyImmutableAuthorityInputs(authority, 'after launch');
    const outputIndex = authority.mount_plan.entries.findIndex((entry) => entry.kind === 'output');
    const output = descriptorOutputIdentity(descriptors[outputIndex], authority);
    return freeze({
      passed: ended.code === 0 && !timedOut && !outputFlood
        && output.size <= CANDIDATE_OUTPUT_MAX_BYTES && descendantsRemaining.length === 0,
      code: ended.code,
      signal: ended.signal,
      timed_out: timedOut,
      output_flood: outputFlood,
      stdout: stdout.toString('utf8'),
      stderr: stderr.toString('utf8'),
      output,
      descendants_observed: observed.size,
      descendants_remaining: descendantsRemaining,
      cleanup_verified: false,
      limitation: CANDIDATE_SANDBOX_LIMITATION,
      source_snapshot_limitation: CANDIDATE_SOURCE_SNAPSHOT_LIMITATION,
    });
  } finally {
    AUTHORITY_STATES.set(authority, 'consumed');
    for (const descriptor of descriptors) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}
