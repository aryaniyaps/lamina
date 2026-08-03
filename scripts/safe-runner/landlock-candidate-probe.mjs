import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeRunnerContext } from '../../packages/cli/lib/safe-runner-context.mjs';
import {
  descendantRecords, identityAlive, processIdentity, processRecord,
} from './processes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = path.join(
  ROOT, 'benchmarks/real-repository-oracle-v1/landlock-candidate-launcher.c',
);
const ADAPTER = path.join(ROOT, 'tests/fixtures/landlock-candidate-adversary.mjs');
const REVIEWED_SOURCE_SHA256 = 'e1c3579394db06fb6024444bfe2c5faa0cf94d3571ea0122954b5e5e7c7b99db';
const O_PATH = 0x200000;
const O_TMPFILE = 0x410000;
const MAX_IDENTITY_BYTES = 128 * 1024 * 1024;
const BASE_RIGHTS = Object.freeze([
  'execute', 'write_file', 'read_file', 'read_dir', 'remove_dir', 'remove_file',
  'make_char', 'make_dir', 'make_reg', 'make_sock', 'make_fifo', 'make_block',
  'make_sym', 'refer', 'truncate',
]);
const SECCOMP_DENIED_SYSCALL_CLASSES = Object.freeze({
  persistent_metadata: [
    'chmod', 'fchmod', 'fchmodat', 'fchmodat2', 'chown', 'fchown', 'lchown',
    'fchownat', 'utime', 'utimes', 'futimesat', 'utimensat', 'setxattr',
    'lsetxattr', 'fsetxattr', 'removexattr', 'lremovexattr', 'fremovexattr',
  ],
  anonymous_executable: ['memfd_create'],
  filesystem_topology: [
    'mount', 'umount2', 'pivot_root', 'chroot', 'open_tree', 'move_mount',
    'fsopen', 'fsconfig', 'fsmount', 'fspick', 'mount_setattr',
    'open_by_handle_at', 'name_to_handle_at', 'mknod', 'mknodat', 'unshare', 'setns',
  ],
  kernel_process_privilege: [
    'bpf', 'ptrace', 'userfaultfd', 'perf_event_open', 'process_vm_writev',
    'pidfd_getfd', 'fanotify_init', 'io_uring_setup', 'add_key', 'request_key',
    'keyctl', 'kexec_load', 'finit_module', 'init_module', 'delete_module',
    'swapon', 'swapoff', 'reboot', 'iopl', 'ioperm', 'sethostname',
    'setdomainname', 'acct', 'quotactl', 'capset', 'setuid', 'setgid',
    'setreuid', 'setregid', 'setresuid', 'setresgid', 'setfsuid', 'setfsgid',
    'setgroups', 'personality', 'modify_ldt',
  ],
});

function sha256File(file, maximumBytes = MAX_IDENTITY_BYTES) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
    throw new Error(`identity input is not a bounded regular file: ${file}`);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileIdentity(file, { digest = true } = {}) {
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
    const identity = fileIdentity(resolved);
    if ((identity.mode & 0o022) !== 0) {
      throw new Error(`compiler subprogram is group/world writable: ${identity.path}`);
    }
    files.set(identity.path, { role: program, ...identity });
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function compileLauncher(temporaryDirectory) {
  const temporaryStat = fs.lstatSync(temporaryDirectory);
  const temporaryFilesystem = fs.statfsSync(temporaryDirectory);
  if (!temporaryStat.isDirectory() || temporaryStat.isSymbolicLink()
    || fs.realpathSync.native(temporaryDirectory) !== temporaryDirectory
    || (temporaryStat.mode & 0o777) !== 0o700
    || Number(temporaryFilesystem.type) !== 0x01021994) {
    throw new Error('compiler temporary directory is not the exact bounded outer tmpfs');
  }
  const source = fileIdentity(SOURCE);
  const sourceDigest = source.sha256;
  if (sourceDigest !== REVIEWED_SOURCE_SHA256) {
    throw new Error('reviewed Landlock launcher source digest changed');
  }
  const compiler = fileIdentity('/usr/bin/cc');
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

function queryAbi(launcherFd) {
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

function runtimeClosure(nodeIdentity) {
  const ldd = fileIdentity('/usr/bin/ldd');
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
  if (paths.size < 2 || paths.size > 32) {
    throw new Error(`candidate runtime closure is outside reviewed bounds: ${paths.size}`);
  }
  return {
    resolver: ldd,
    files: [...paths].sort().map((file) => fileIdentity(file)),
    configuration: fileIdentity('/etc/ssl/openssl.cnf'),
  };
}

function outerContext() {
  const context = assertSafeRunnerContext('Landlock candidate feasibility probe');
  const temporaryDirectory = fs.realpathSync.native(process.env.LAMINA_SAFE_RUNNER_TEMP || '');
  const statfs = fs.statfsSync(temporaryDirectory);
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  const namespacePids = status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/) || [];
  const parentPid = Number(status.match(/^PPid:\s+(\d+)$/m)?.[1]);
  const uidMap = fs.readFileSync('/proc/self/uid_map', 'utf8').trim();
  const networkInterfaces = os.networkInterfaces();
  const interfaceNames = Object.keys(networkInterfaces).sort();
  const loopbackOnly = interfaceNames.length === 1 && interfaceNames[0] === 'lo'
    && networkInterfaces.lo.length > 0
    && networkInterfaces.lo.every((address) => address.internal === true);
  const facts = {
    adapter: context.adapter,
    self_pid: process.pid,
    parent_pid: parentPid,
    pid_one_visible: fs.existsSync('/proc/1/status'),
    namespace_pid_count: namespacePids.length,
    uid_map: uidMap,
    uid_map_exact: /^0\s+\d+\s+1$/.test(uidMap),
    allow_network_control_absent: process.env.LAMINA_SAFE_RUNNER_ALLOW_NETWORK === undefined,
    network_interfaces: interfaceNames,
    network_interface_records: networkInterfaces,
    loopback_only: loopbackOnly,
    filesystem_type: Number(statfs.type),
  };
  if (context.adapter !== 'linux-systemd-cgroup-v2'
    || namespacePids.length !== 1 || process.pid < 2 || process.pid > 16
    || parentPid < 1 || parentPid >= process.pid || !fs.existsSync('/proc/1/status')
    || !/^0\s+\d+\s+1$/.test(uidMap)
    || process.env.LAMINA_SAFE_RUNNER_ALLOW_NETWORK !== undefined
    || !loopbackOnly
    || Number(statfs.type) !== 0x01021994) {
    throw new Error(`generic outer safe-runner isolation context is incomplete: ${JSON.stringify(facts)}`);
  }
  for (const name of [
    'DBUS_SESSION_BUS_ADDRESS', 'DBUS_SYSTEM_BUS_ADDRESS', 'DOCKER_HOST',
    'CONTAINER_HOST', 'CONTAINERD_ADDRESS', 'PODMAN_HOST', 'XDG_RUNTIME_DIR',
  ]) {
    if (process.env[name]) throw new Error(`outer control environment survived: ${name}`);
  }
  return {
    temporaryDirectory,
    report: {
      generic_safe_runner: true,
      systemd_cgroup: true,
      user_namespace: true,
      pid_namespace: true,
      network_namespace: true,
      bounded_tmpfs: true,
      control_sockets_masked: true,
    },
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

function repositoryManifest(repository) {
  const statFields = (target) => {
    const stat = fs.lstatSync(target, { bigint: true });
    return {
      dev: String(stat.dev), ino: String(stat.ino), mode: Number(stat.mode),
      uid: Number(stat.uid), gid: Number(stat.gid),
      mtime_ns: String(stat.mtimeNs), ctime_ns: String(stat.ctimeNs),
    };
  };
  const entries = fs.readdirSync(repository).sort();
  const files = Object.fromEntries(entries.map((name) => {
    const target = path.join(repository, name);
    return [name, { ...statFields(target), content_sha256: sha256File(target) }];
  }));
  const manifest = { directory: { ...statFields(repository), entries }, files };
  return {
    manifest,
    sha256: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
  };
}

function waitForCandidate(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let ready = false;
    let identity = null;
    let record = null;
    let descendants = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!ready && stdout === 'READY\n') {
        ready = true;
        record = processRecord(child.pid);
        identity = processIdentity(child.pid);
        descendants = descendantRecords(child.pid).map((item) => processIdentity(item.pid))
          .filter(Boolean);
        if (!record || !identity) {
          reject(new Error('candidate identity disappeared before release'));
          return;
        }
        child.stdin.end('G');
      }
    });
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      if (!ready) return reject(new Error(`candidate did not reach release gate: ${stderr}`));
      resolve({ exitCode, signal, stdout, stderr, identity, record, descendants });
    });
  });
}

async function executeAdversary({
  launcherFd, abi, node, closure, inputFile, repository, outputFile, scratchFile,
}) {
  const descriptors = [
    openPinned(node.path), openPinned(ADAPTER), openPinned(inputFile),
    openPinned(repository, 'directory'), openPinned(outputFile),
    openPinned(scratchFile, 'writable-file'),
    openPinned(closure.configuration.path),
    ...closure.files.map((item) => openPinned(item.path)),
  ];
  try {
    const childFds = descriptors.map((_, index) => index + 4);
    const [nodeFd, adapterFd, inputFd, repositoryFd, outputFd, scratchFd,
      configurationFd, ...runtimeFds]
      = childFds;
    const args = [
      'run', String(abi), String(nodeFd), String(adapterFd), String(inputFd),
      String(repositoryFd), String(outputFd), String(scratchFd), String(configurationFd),
      String(runtimeFds.length),
      ...runtimeFds.map(String), '--', node.path, ADAPTER, inputFile, repository,
      outputFile, scratchFile,
    ];
    const child = spawn('/proc/self/fd/3', args, {
      stdio: ['pipe', 'pipe', 'pipe', launcherFd, ...descriptors],
      env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' },
    });
    const execution = await waitForCandidate(child);
    const executable = fs.statSync(node.path, { bigint: true });
    const exact = execution.record?.start_ticks === execution.identity.start_ticks
      && execution.record.executable_identity?.dev === String(executable.dev)
      && execution.record.executable_identity?.ino === String(executable.ino);
    const stillAlive = [execution.identity, ...execution.descendants].filter(identityAlive);
    if (!exact || execution.exitCode !== 0 || execution.signal !== null
      || execution.stdout !== 'READY\n' || execution.stderr !== '' || stillAlive.length > 0) {
      throw new Error(`candidate execution attestation failed: ${JSON.stringify({
        exact, exitCode: execution.exitCode, signal: execution.signal,
        stdout: execution.stdout, stderr: execution.stderr, stillAlive,
      })}`);
    }
    return {
      identity_exact: true,
      exit_code: execution.exitCode,
      signal: execution.signal,
      descendants_remaining: [],
      result: JSON.parse(fs.readFileSync(outputFile, 'utf8')),
    };
  } finally {
    for (const descriptor of descriptors) fs.closeSync(descriptor);
  }
}

export async function runLandlockCandidateProbe() {
  const outer = outerContext();
  const probeRoot = fs.realpathSync.native(fs.mkdtempSync(
    path.join(outer.temporaryDirectory, 'landlock-candidate-'),
  ));
  fs.chmodSync(probeRoot, 0o700);
  let launcher = null;
  let result = null;
  try {
    const repository = path.join(probeRoot, 'repository');
    const inputFile = path.join(probeRoot, 'input.json');
    const hiddenFile = path.join(probeRoot, 'hidden.txt');
    const outputFile = path.join(probeRoot, 'output.json');
    const scratchFile = path.join(probeRoot, 'scratch.txt');
    const elsewhereFile = path.join(probeRoot, 'elsewhere.txt');
    const extraExecutable = path.join(probeRoot, 'candidate-extra-executable');
    fs.mkdirSync(repository, { mode: 0o700 });
    fs.writeFileSync(path.join(repository, 'visible.txt'), 'repository-visible\n');
    fs.writeFileSync(hiddenFile, 'private-controller-material\n');
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(scratchFile, '');
    fs.writeFileSync(inputFile, `${JSON.stringify({
      token: 'public-token', hidden_file: hiddenFile, elsewhere_file: elsewhereFile,
      extra_executable: extraExecutable, control_socket: '/run/systemd/private',
    })}\n`);

    launcher = compileLauncher(probeRoot);
    const abi = queryAbi(launcher.fd);
    const node = fileIdentity(process.execPath);
    const closure = runtimeClosure(node);
    const manifestBefore = repositoryManifest(repository);
    let candidate;
    try {
      candidate = await executeAdversary({
        launcherFd: launcher.fd, abi, node, closure, inputFile, repository, outputFile, scratchFile,
      });
    } catch (error) {
      throw new Error(`Landlock ABI ${abi} candidate launch failed: ${error.message}`, { cause: error });
    }
    const manifestAfter = repositoryManifest(repository);
    if (JSON.stringify(manifestAfter.manifest) !== JSON.stringify(manifestBefore.manifest)
      || fs.readFileSync(hiddenFile, 'utf8') !== 'private-controller-material\n'
      || fs.readdirSync(repository).join(',') !== 'visible.txt'
      || fs.existsSync(elsewhereFile) || fs.existsSync(extraExecutable)) {
      throw new Error('candidate left a denied filesystem side effect');
    }
    candidate.filesystem_side_effects_absent = true;
    candidate.repository_manifest_equal = true;
    candidate.repository_manifest_before_sha256 = manifestBefore.sha256;
    candidate.repository_manifest_after_sha256 = manifestAfter.sha256;
    candidate.repository_manifest_fields = [
      'dev', 'ino', 'mode', 'uid', 'gid', 'mtime_ns', 'ctime_ns',
      'directory_entries', 'file_content_sha256',
    ];
    result = {
      schema: 'lamina.safe-runner-landlock-candidate-probe/v2',
      non_gradeable: true,
      cleanup_proof_issued: false,
      grading_reachable: false,
      candidate_executed: false,
      adversarial_probe_executed: true,
      outer_context: outer.report,
      landlock: {
        reviewed_uapi: 'linux-v7.0',
        abi,
        base_rights: [...BASE_RIGHTS],
        handled_rights: [
          ...BASE_RIGHTS,
          ...(abi >= 5 ? ['ioctl_dev'] : []),
          ...(abi >= 4 ? ['bind_tcp', 'connect_tcp'] : []),
        ],
        scopes: abi >= 6 ? ['abstract_unix_socket', 'signal'] : [],
        tsync: abi >= 8,
        fail_closed_above_abi: 8,
      },
      seccomp: {
        policy: 'lamina.landlock-candidate-seccomp/x86_64-v1',
        architecture: 'x86_64',
        unsupported_architecture_action: 'compile_refusal',
        kernel_install_failure_action: 'launch_refusal',
        denied_errno: 'EPERM',
        inherited_across_exec: true,
        native_self_tests: ['writable-fd-fchmod:EPERM', 'memfd_create:EPERM'],
        denied_syscall_classes: SECCOMP_DENIED_SYSCALL_CLASSES,
      },
      build: {
        ...launcher.attestation,
        runtime: node,
        runtime_closure: closure.files,
        runtime_configuration: {
          ...closure.configuration,
          allowed_rights: ['read_file'],
        },
        runtime_resolver: closure.resolver,
        compiler_identity_scope:
          'partial root-owned executable evidence; headers and static-link inputs are not a complete closure',
      },
      candidate,
    };
  } finally {
    if (launcher) fs.closeSync(launcher.fd);
    fs.rmSync(probeRoot, { recursive: true, force: false });
    if (fs.existsSync(probeRoot)) throw new Error('probe temporary root survived cleanup');
  }
  return { ...result, probe_temp_entries_after_cleanup: [] };
}
