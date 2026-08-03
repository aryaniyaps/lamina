import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
export const CANDIDATE_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_TREE_FILES = 120_000;
const MAX_TREE_BYTES = 768 * 1024 * 1024;
const ISSUED_AUTHORITIES = new WeakSet();

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

function physicalDirectory(candidate, label, { privateMode = false } = {}) {
  const absolute = path.resolve(String(candidate || ''));
  const stat = fs.lstatSync(absolute, { bigint: true });
  if (!path.isAbsolute(String(candidate || '')) || absolute !== candidate
    || fs.realpathSync.native(absolute) !== absolute || !stat.isDirectory()
    || stat.isSymbolicLink() || (process.platform !== 'win32'
      && (stat.uid !== BigInt(process.getuid()) || (privateMode && (stat.mode & 0o077n) !== 0n)))) {
    throw new Error(`${label} must be an exact physical directory`);
  }
  return { path: absolute, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid) };
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
    mode: Number(stat.mode & 0o7777n), size: bytes.length, sha256: sha256(bytes),
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
        records.push({ path: relative, type: 'directory', mode: Number(stat.mode & 0o7777n) });
        pending.push({ absolute, relative });
      } else if (stat.isFile() && !stat.isSymbolicLink()) {
        const content = fs.readFileSync(absolute);
        bytes += content.length;
        records.push({
          path: relative, type: 'file', mode: Number(stat.mode & 0o7777n),
          bytes: content.length, sha256: sha256(content),
        });
      } else if (stat.isSymbolicLink() && allowSymlinks) {
        records.push({ path: relative, type: 'symlink', target: fs.readlinkSync(absolute) });
      } else throw new Error(`${label} contains unsupported filesystem content`);
      if (records.length > MAX_TREE_FILES || bytes > MAX_TREE_BYTES) {
        throw new Error(`${label} exceeds bounded identity limits`);
      }
    }
  }
  records.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return freeze({ root_identity: rootIdentity, files: records.length, bytes, sha256: digest(records) });
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

export function candidateBubblewrapArguments({
  runtime_fd: runtimeFd = 3,
  adapter_fd: adapterFd = 4,
  input_fd: inputFd = 5,
  repository_fd: repositoryFd = 6,
  output_fd: outputFd = 7,
  adapter_entrypoint: adapterEntrypoint,
  platform = process.platform,
} = {}) {
  if (platform !== 'linux') throw new Error('candidate sandbox execution requires Linux');
  const entrypoint = safeRelative(adapterEntrypoint, 'candidate adapter entrypoint');
  for (const fd of [runtimeFd, adapterFd, inputFd, repositoryFd, outputFd]) {
    if (!Number.isSafeInteger(fd) || fd < 3 || fd > 63) throw new Error('candidate mount fd is invalid');
  }
  return [
    '--die-with-parent', '--new-session',
    '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-net',
    '--uid', '0', '--gid', '0', '--hostname', 'lamina-candidate',
    '--disable-userns', '--assert-userns-disabled', '--cap-drop', 'ALL', '--clearenv',
    '--tmpfs', '/',
    '--dir', '/runtime', '--dir', '/candidate', '--dir', '/input',
    '--dir', '/repository', '--dir', '/output',
    '--ro-bind-fd', String(runtimeFd), '/runtime',
    '--ro-bind-fd', String(adapterFd), '/candidate',
    '--ro-bind-fd', String(inputFd), '/input/public.json',
    '--ro-bind-fd', String(repositoryFd), '/repository',
    '--bind-fd', String(outputFd), '/output/result',
    '--chmod', '0555', '/output',
    '--proc', '/proc', '--dev', '/dev',
    '--perms', '0700', '--size', String(CANDIDATE_OUTPUT_MAX_BYTES), '--tmpfs', '/tmp',
    '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'LC_ALL', 'C.UTF-8',
    '--setenv', 'TZ', 'UTC', '--setenv', 'PATH', '/runtime', '--setenv', 'TMPDIR', '/tmp',
    '--chdir', '/repository',
    '--', '/runtime/loader', '--library-path', '/runtime', '/runtime/node',
    `/candidate/${entrypoint}`, '/input/public.json', '/repository', '/output/result',
  ];
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
  if (!adapter.files || !fs.existsSync(path.join(adapterRoot, adapterEntry))) {
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
  const prlimit = trustedRootHostBinary('prlimit');
  const bwrapArguments = candidateBubblewrapArguments({ adapter_entrypoint: adapterEntry });
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
    timeout_ms: validateTimeout(timeoutMs),
    git_dependent: gitDependent,
    infrastructure: { bwrap, prlimit },
    bwrap_arguments: bwrapArguments,
    prlimit_arguments: prlimitArguments,
    argv_sha256: digest({ executable: prlimit.path, argv: prlimitArguments }),
    environment: {
      LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', PATH: '/runtime', TMPDIR: '/tmp',
      PWD: '/repository',
    },
    limitation: CANDIDATE_SANDBOX_LIMITATION,
  });
  ISSUED_AUTHORITIES.add(authority);
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
  if (!authority || !ISSUED_AUTHORITIES.has(authority)) {
    throw new Error('candidate launch authority was not issued by this host process');
  }
  verifyImmutableAuthorityInputs(authority, 'before launch');
  if (!same(physicalFile(authority.output_file, 'candidate output', { empty: true }),
    authority.output_identity)) {
    throw new Error('candidate launch authority input identity changed before launch');
  }
  return authority;
}

function openMount(candidate, directory, expected, writable = false) {
  const descriptor = fs.openSync(candidate, (writable ? fs.constants.O_RDWR : fs.constants.O_RDONLY)
    | fs.constants.O_NOFOLLOW
    | (directory ? fs.constants.O_DIRECTORY : 0));
  const stat = fs.fstatSync(descriptor, { bigint: true });
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink()
    || String(stat.dev) !== String(expected.dev) || String(stat.ino) !== String(expected.ino)
    || Number(stat.uid) !== Number(expected.uid)
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
  if (process.platform !== 'linux') throw new Error('candidate sandbox execution requires Linux');
  verifyAuthority(authority);
  const descriptors = [
    openMount(authority.runtime_snapshot.root, true, authority.runtime_snapshot.root_identity),
    openMount(authority.adapter_root, true, authority.adapter_identity.root_identity),
    openMount(authority.public_input, false, authority.public_input_identity),
    openMount(authority.repository, true, authority.repository_identity.root_identity),
    openMount(authority.output_file, false, authority.output_identity, true),
  ];
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
    const output = descriptorOutputIdentity(descriptors[4], authority);
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
    });
  } finally {
    for (const descriptor of descriptors) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}
