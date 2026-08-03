import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  descendantRecords, identityAlive, processIdentity, processRecord,
} from './processes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = path.join(
  ROOT, 'benchmarks/real-repository-oracle-v1/landlock-candidate-launcher.c',
);
const REVIEWED_SOURCE_SHA256 = 'f64baf725f1df7f6461866044fef542bde09d76706826533f8413cf4f54a64c9';
const O_PATH = 0x200000;
const O_TMPFILE = 0x410000;
const MAX_IDENTITY_BYTES = 128 * 1024 * 1024;
const MAX_RUNTIME_FILES = 32;
export const LANDLOCK_CANDIDATE_CANARY_MIN_FD = 1025;
export const LANDLOCK_CANDIDATE_REPOSITORY_FD = 7;
export const LANDLOCK_CANDIDATE_REPOSITORY_ALIAS =
  `/proc/self/fd/${LANDLOCK_CANDIDATE_REPOSITORY_FD}`;
const CANDIDATE_ARGUMENTS = Object.freeze(
  Array.from({ length: 6 }, (_, index) => `/proc/self/fd/${index + 4}`),
);
export const LANDLOCK_CANDIDATE_BASE_RIGHTS = Object.freeze([
  'execute', 'write_file', 'read_file', 'read_dir', 'remove_dir', 'remove_file',
  'make_char', 'make_dir', 'make_reg', 'make_sock', 'make_fifo', 'make_block',
  'make_sym', 'refer', 'truncate',
]);
export const SECCOMP_DENIED_SYSCALL_CLASSES = Object.freeze({
  persistent_metadata: Object.freeze([
    'chmod', 'fchmod', 'fchmodat', 'fchmodat2', 'chown', 'fchown', 'lchown',
    'fchownat', 'utime', 'utimes', 'futimesat', 'utimensat', 'setxattr',
    'lsetxattr', 'fsetxattr', 'removexattr', 'lremovexattr', 'fremovexattr',
    'setxattrat', 'removexattrat', 'file_setattr',
  ]),
  process_creation: Object.freeze(['fork', 'vfork']),
  network_creation: Object.freeze(['socket', 'socketpair']),
  anonymous_executable: Object.freeze(['memfd_create']),
  filesystem_topology: Object.freeze([
    'mount', 'umount2', 'pivot_root', 'chroot', 'open_tree', 'move_mount',
    'fsopen', 'fsconfig', 'fsmount', 'fspick', 'mount_setattr',
    'open_by_handle_at', 'name_to_handle_at', 'mknod', 'mknodat', 'unshare', 'setns',
  ]),
  kernel_process_privilege: Object.freeze([
    'bpf', 'ptrace', 'userfaultfd', 'perf_event_open', 'process_vm_writev',
    'pidfd_getfd', 'fanotify_init', 'io_uring_setup', 'add_key', 'request_key',
    'keyctl', 'kexec_load', 'finit_module', 'init_module', 'delete_module',
    'swapon', 'swapoff', 'reboot', 'iopl', 'ioperm', 'sethostname',
    'setdomainname', 'acct', 'quotactl', 'capset', 'setuid', 'setgid',
    'setreuid', 'setregid', 'setresuid', 'setresgid', 'setfsuid', 'setfsgid',
    'setgroups', 'personality', 'modify_ldt',
  ]),
});

export function landlockCandidateDescriptorLayout(runtimeCount) {
  if (!Number.isSafeInteger(runtimeCount) || runtimeCount < 0
    || runtimeCount > MAX_RUNTIME_FILES) {
    throw new TypeError('Landlock candidate runtime closure descriptor count is out of bounds');
  }
  return Object.freeze({
    launcher: 3,
    node: 4,
    adapter: 5,
    input: 6,
    repository: LANDLOCK_CANDIDATE_REPOSITORY_FD,
    output: 8,
    scratch: 9,
    configuration: 10,
    runtimes: Object.freeze(Array.from({ length: runtimeCount }, (_, index) => 11 + index)),
    candidate_argv: CANDIDATE_ARGUMENTS,
    repository_alias: LANDLOCK_CANDIDATE_REPOSITORY_ALIAS,
  });
}

export function landlockCandidateArguments() {
  return [...CANDIDATE_ARGUMENTS];
}

function sha256File(file, maximumBytes = MAX_IDENTITY_BYTES) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
    throw new Error(`identity input is not a bounded regular file: ${file}`);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function landlockCandidateFileIdentity(file, { digest = true } = {}) {
  const physical = fs.realpathSync.native(file);
  const stat = fs.statSync(physical, { bigint: true });
  if (!stat.isFile() || stat.size <= 0n || stat.size > BigInt(MAX_IDENTITY_BYTES)) {
    throw new Error(`identity input is not a bounded regular file: ${physical}`);
  }
  return {
    path: physical,
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: Number(stat.uid),
    mode: Number(stat.mode),
    size: Number(stat.size),
    ...(digest ? { sha256: sha256File(physical) } : {}),
  };
}

function sameInode(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function compilerToolchain(compilerFd) {
  const files = new Map();
  for (const program of ['cc1', 'as', 'ld', 'collect2']) {
    const result = spawnSync('/proc/self/fd/3', [`-print-prog-name=${program}`], {
      stdio: ['ignore', 'pipe', 'pipe', compilerFd], encoding: 'utf8',
      timeout: 2_000, maxBuffer: 8 * 1024,
      env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' },
    });
    if (result.error || result.status !== 0 || result.signal !== null || result.stderr !== '') {
      throw new Error(`compiler ${program} identity query failed`);
    }
    const declared = result.stdout.trim();
    const resolved = path.isAbsolute(declared) ? declared : `/usr/bin/${declared}`;
    const identity = landlockCandidateFileIdentity(resolved);
    if ((identity.mode & 0o022) !== 0) {
      throw new Error(`compiler subprogram is group/world writable: ${identity.path}`);
    }
    files.set(identity.path, { role: program, ...identity });
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function compileLandlockCandidateLauncher(temporaryDirectory) {
  const temporaryStat = fs.lstatSync(temporaryDirectory);
  const temporaryFilesystem = fs.statfsSync(temporaryDirectory);
  if (!temporaryStat.isDirectory() || temporaryStat.isSymbolicLink()
    || fs.realpathSync.native(temporaryDirectory) !== temporaryDirectory
    || (temporaryStat.mode & 0o777) !== 0o700
    || Number(temporaryFilesystem.type) !== 0x01021994) {
    throw new Error('compiler temporary directory is not the exact bounded outer tmpfs');
  }
  const source = landlockCandidateFileIdentity(SOURCE);
  const sourceDigest = source.sha256;
  if (sourceDigest !== REVIEWED_SOURCE_SHA256) {
    throw new Error('reviewed Landlock launcher source digest changed');
  }
  const compiler = landlockCandidateFileIdentity('/usr/bin/cc');
  const sourceFd = fs.openSync(SOURCE, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const compilerFd = fs.openSync(compiler.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const writableOutputFd = fs.openSync(temporaryDirectory, O_TMPFILE | fs.constants.O_RDWR, 0o700);
  let readOnlyOutputFd = null;
  try {
    const sourceFdStat = fs.fstatSync(sourceFd, { bigint: true });
    if (!sameInode(sourceFdStat, source)) throw new Error('reviewed source descriptor changed');
    const toolchain = compilerToolchain(compilerFd);
    const compile = spawnSync('/proc/self/fd/4', [
      '-x', 'c', '-std=c17', '-O2', '-static', '-Wall', '-Wextra', '-Werror',
      '-Wl,--build-id=none', '/proc/self/fd/3', '-o', '/proc/self/fd/5',
    ], {
      stdio: ['ignore', 'pipe', 'pipe', sourceFd, compilerFd, writableOutputFd],
      encoding: 'utf8', timeout: 20_000, maxBuffer: 128 * 1024,
      cwd: temporaryDirectory,
      env: {
        LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin',
        TMPDIR: temporaryDirectory, TMP: temporaryDirectory, TEMP: temporaryDirectory,
      },
    });
    if (compile.error || compile.status !== 0 || compile.signal !== null
      || compile.stdout !== '' || compile.stderr !== '') {
      throw new Error(`anonymous launcher compilation failed: ${JSON.stringify({
        error: compile.error?.message || null, status: compile.status, signal: compile.signal,
        stdout: compile.stdout, stderr: compile.stderr,
      })}`);
    }
    fs.fchmodSync(writableOutputFd, 0o500);
    fs.fsyncSync(writableOutputFd);
    const writableStat = fs.fstatSync(writableOutputFd, { bigint: true });
    readOnlyOutputFd = fs.openSync(`/proc/self/fd/${writableOutputFd}`, fs.constants.O_RDONLY);
    const readOnlyStat = fs.fstatSync(readOnlyOutputFd, { bigint: true });
    if (!sameInode(writableStat, readOnlyStat) || !readOnlyStat.isFile()
      || readOnlyStat.size <= 0n || readOnlyStat.size > 4n * 1024n * 1024n) {
      throw new Error('anonymous launcher output identity or bound changed');
    }
    const outputSha256 = crypto.createHash('sha256')
      .update(fs.readFileSync(`/proc/self/fd/${readOnlyOutputFd}`)).digest('hex');
    fs.closeSync(writableOutputFd);
    return {
      fd: readOnlyOutputFd,
      attestation: {
        source_sha256: sourceDigest,
        source,
        source_fd_pinned: true,
        compiler,
        compiler_toolchain: toolchain,
        output_sha256: outputSha256,
        output_bytes: Number(readOnlyStat.size),
        output_anonymous: true,
        output_reopened_read_only: true,
        writable_output_fd_closed_before_exec: true,
        exact_flags: [
          '-x', 'c', '-std=c17', '-O2', '-static', '-Wall', '-Wextra', '-Werror',
          '-Wl,--build-id=none', '/proc/self/fd/3', '-o', '/proc/self/fd/5',
        ],
      },
    };
  } catch (error) {
    if (readOnlyOutputFd !== null) fs.closeSync(readOnlyOutputFd);
    try { fs.closeSync(writableOutputFd); } catch {}
    throw error;
  } finally {
    fs.closeSync(sourceFd);
    fs.closeSync(compilerFd);
  }
}

export function queryLandlockCandidateAbi(launcherFd) {
  const result = spawnSync('/proc/self/fd/3', ['query'], {
    stdio: ['ignore', 'pipe', 'pipe', launcherFd], encoding: 'utf8',
    timeout: 2_000, maxBuffer: 8 * 1024,
    env: { LANG: 'C', LC_ALL: 'C' },
  });
  if (result.error || result.status !== 0 || result.signal !== null || result.stderr !== '') {
    throw new Error(`Landlock ABI query failed: ${JSON.stringify({
      error: result.error?.message || null, status: result.status,
      signal: result.signal, stderr: result.stderr,
    })}`);
  }
  if (!/^[3-8]\n$/.test(result.stdout)) {
    throw new Error(`Landlock ABI is outside reviewed Linux v7.0 range: ${result.stdout.trim()}`);
  }
  return Number(result.stdout.trim());
}

export function landlockCandidateRuntimeClosure(nodeIdentity, precomputed = null) {
  if (precomputed) {
    if (!precomputed.resolver || !Array.isArray(precomputed.files)
      || !precomputed.configuration
      || precomputed.files.length < 2 || precomputed.files.length > MAX_RUNTIME_FILES) {
      throw new Error('precomputed candidate runtime closure is invalid');
    }
    return precomputed;
  }
  const ldd = landlockCandidateFileIdentity('/usr/bin/ldd');
  const result = spawnSync(ldd.path, [nodeIdentity.path], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 2_000,
    maxBuffer: 64 * 1024, env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' },
  });
  if (result.error || result.status !== 0 || result.signal !== null || result.stderr !== '') {
    throw new Error('trusted ldd could not resolve the exact candidate runtime closure');
  }
  const paths = new Set();
  for (const line of result.stdout.trim().split('\n')) {
    const match = line.match(/=>\s+(\/\S+)\s+\(0x[0-9a-f]+\)$/i)
      || line.match(/^\s*(\/\S+)\s+\(0x[0-9a-f]+\)$/i);
    if (match) paths.add(fs.realpathSync.native(match[1]));
    else if (!line.includes('linux-vdso.so.1')) {
      throw new Error(`unrecognized ldd runtime closure line: ${line}`);
    }
  }
  if (paths.size < 2 || paths.size > MAX_RUNTIME_FILES) {
    throw new Error(`candidate runtime closure is outside reviewed bounds: ${paths.size}`);
  }
  return {
    resolver: ldd,
    files: [...paths].sort().map((file) => landlockCandidateFileIdentity(file)),
    configuration: landlockCandidateFileIdentity('/etc/ssl/openssl.cnf'),
  };
}

function openPinned(file, type = 'file') {
  const descriptor = fs.openSync(file, type === 'writable-file'
    ? fs.constants.O_RDWR | fs.constants.O_NOFOLLOW
    : O_PATH | fs.constants.O_NOFOLLOW);
  const stat = fs.fstatSync(descriptor);
  if ((['file', 'writable-file'].includes(type) && !stat.isFile())
    || (type === 'directory' && !stat.isDirectory())) {
    fs.closeSync(descriptor);
    throw new Error(`pinned candidate input type changed: ${file}`);
  }
  return descriptor;
}

export async function executeLandlockCandidate({
  launcherFd, abi, node, closure, adapter, inputFile, repository, outputFile, scratchFile,
  readyLine = null, releaseToken = null, timeoutMs = 10_000, maximumOutputBytes = 64 * 1024,
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000
    || !Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1
    || maximumOutputBytes > 1024 * 1024
    || (readyLine === null) !== (releaseToken === null)) {
    throw new TypeError('Landlock candidate execution bounds or release gate are invalid');
  }
  const descriptors = [
    openPinned(node.path), openPinned(adapter), openPinned(inputFile),
    openPinned(repository, 'directory'), openPinned(outputFile),
    openPinned(scratchFile, 'writable-file'), openPinned(closure.configuration.path),
    ...closure.files.map((item) => openPinned(item.path)),
  ];
  try {
    const layout = landlockCandidateDescriptorLayout(closure.files.length);
    const args = [
      'run', String(abi), String(layout.node), String(layout.adapter), String(layout.input),
      String(layout.repository), String(layout.output), String(layout.scratch),
      String(layout.configuration), String(layout.runtimes.length),
      ...layout.runtimes.map(String), '--',
    ];
    const child = spawn('/proc/self/fd/3', args, {
      stdio: ['pipe', 'pipe', 'pipe', launcherFd, ...descriptors],
      env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' },
    });
    return await new Promise((resolve, reject) => {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let released = readyLine === null;
      let identity = null;
      let record = null;
      let descendants = [];
      let settled = false;
      let terminationError = null;
      let outputBytes = 0;
      const finish = (operation, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        operation(value);
      };
      const append = (current, chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > maximumOutputBytes && terminationError === null) {
          terminationError = new Error('candidate stdout/stderr exceeded its combined nested byte bound');
          child.kill('SIGKILL');
        }
        if (terminationError) return current;
        return Buffer.concat([current, chunk]);
      };
      const timer = setTimeout(() => {
        if (terminationError === null) {
          terminationError = new Error('candidate exceeded its nested runtime bound');
          child.kill('SIGKILL');
        }
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout = append(stdout, chunk);
        if (!released && stdout.toString('utf8') === readyLine) {
          record = processRecord(child.pid);
          identity = processIdentity(child.pid);
          descendants = descendantRecords(child.pid).map((item) => processIdentity(item.pid))
            .filter(Boolean);
          if (!record || !identity) {
            child.kill('SIGKILL');
            finish(reject, new Error('candidate identity disappeared before release'));
            return;
          }
          released = true;
          child.stdin.end(releaseToken);
        }
      });
      child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
      child.once('error', (error) => finish(reject, error));
      child.once('close', (exitCode, signal) => {
        if (terminationError) {
          terminationError.execution = {
            exit_code: exitCode, signal, stdout_bytes: stdout.length,
            stderr_bytes: stderr.length, descendants_remaining: [identity, ...descendants]
              .filter(Boolean).filter(identityAlive),
          };
          finish(reject, terminationError);
          return;
        }
        if (!released) {
          finish(reject, new Error(`candidate did not reach release gate: ${stderr.toString('utf8')}`));
          return;
        }
        const stillAlive = [identity, ...descendants].filter(Boolean).filter(identityAlive);
        finish(resolve, {
          exitCode, signal, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'),
          identity, record, descendants, descendants_remaining: stillAlive,
          repository_alias: layout.repository_alias,
        });
      });
    });
  } finally {
    for (const descriptor of descriptors) fs.closeSync(descriptor);
  }
}
