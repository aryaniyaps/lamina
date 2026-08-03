import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeRunnerContext } from '../../packages/cli/lib/safe-runner-context.mjs';
import { identityAlive, processIdentity } from './processes.mjs';
import {
  LANDLOCK_CANDIDATE_BASE_RIGHTS,
  SECCOMP_DENIED_SYSCALL_CLASSES,
  compileLandlockCandidateLauncher,
  executeLandlockCandidate,
  landlockCandidateFileIdentity,
  landlockCandidateRuntimeClosure,
  queryLandlockCandidateAbi,
} from './landlock-candidate-launcher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADAPTER = path.join(ROOT, 'tests/fixtures/landlock-candidate-adversary.mjs');
const MAX_IDENTITY_BYTES = 128 * 1024 * 1024;

function sha256File(file, maximumBytes = MAX_IDENTITY_BYTES) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
    throw new Error(`identity input is not a bounded regular file: ${file}`);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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

async function auditPrivatePidNamespace(expectedIdentities) {
  const expected = new Map(expectedIdentities.map((identity) => [identity.pid, identity.start_ticks]));
  let identities = [];
  let unexpected = [];
  let missing = [];
  for (let attempt = 0; attempt < 25; attempt += 1) {
    identities = fs.readdirSync('/proc')
      .filter((name) => /^\d+$/.test(name))
      .map(Number)
      .sort((left, right) => left - right)
      .map(processIdentity)
      .filter(Boolean);
    unexpected = identities.filter(
      (identity) => expected.get(identity.pid) !== identity.start_ticks,
    );
    missing = expectedIdentities.filter(
      (identity) => !identities.some(
        (current) => current.pid === identity.pid && current.start_ticks === identity.start_ticks,
      ),
    );
    if (unexpected.length === 0 && missing.length === 0
      && identities.length === expectedIdentities.length) {
      return {
        verified: true,
        identities,
        unexpected: [],
        missing: [],
        attempts: attempt + 1,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { verified: false, identities, unexpected, missing, attempts: 25 };
}

async function executeAdversary({
  launcherFd, abi, node, closure, inputFile, repository, outputFile, scratchFile,
}) {
  const namespaceAuthorities = [processIdentity(1), processIdentity(process.pid)];
  if (namespaceAuthorities.some((identity) => !identity)
    || namespaceAuthorities[0].pid === namespaceAuthorities[1].pid) {
    throw new Error('private PID namespace authority identities are incomplete');
  }
  const execution = await executeLandlockCandidate({
    launcherFd, abi, node, closure, adapter: ADAPTER, inputFile, repository,
    outputFile, scratchFile, readyLine: 'READY\n', releaseToken: 'G',
  });
  const executable = fs.statSync(node.path, { bigint: true });
  const exact = execution.record?.start_ticks === execution.identity.start_ticks
    && execution.record.executable_identity?.dev === String(executable.dev)
    && execution.record.executable_identity?.ino === String(executable.ino);
  const stillAlive = [execution.identity, ...execution.descendants].filter(identityAlive);
  const namespaceAudit = await auditPrivatePidNamespace(namespaceAuthorities);
  if (!exact || execution.exitCode !== 0 || execution.signal !== null
    || execution.stdout !== 'READY\n' || execution.stderr !== '' || stillAlive.length > 0
    || !namespaceAudit.verified) {
    throw new Error(`candidate execution attestation failed: ${JSON.stringify({
      exact, exitCode: execution.exitCode, signal: execution.signal,
      stdout: execution.stdout, stderr: execution.stderr, stillAlive, namespaceAudit,
    })}`);
  }
  return {
    identity_exact: true,
    exit_code: execution.exitCode,
    signal: execution.signal,
    descendants_remaining: [],
    private_pid_namespace_rescan_verified: true,
    private_pid_namespace_expected_identities: namespaceAuthorities,
    private_pid_namespace_observed_identities: namespaceAudit.identities,
    private_pid_namespace_rescan_attempts: namespaceAudit.attempts,
    unexpected_private_pid_identities: [],
    result: JSON.parse(fs.readFileSync(outputFile, 'utf8')),
  };
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
      controller_path: probeRoot,
    })}\n`);

    launcher = compileLandlockCandidateLauncher(probeRoot);
    const abi = queryLandlockCandidateAbi(launcher.fd);
    const node = landlockCandidateFileIdentity(process.execPath);
    const closure = landlockCandidateRuntimeClosure(node);
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
        base_rights: [...LANDLOCK_CANDIDATE_BASE_RIGHTS],
        handled_rights: [
          ...LANDLOCK_CANDIDATE_BASE_RIGHTS,
          ...(abi >= 5 ? ['ioctl_dev'] : []),
          ...(abi >= 4 ? ['bind_tcp', 'connect_tcp'] : []),
        ],
        scopes: abi >= 6 ? ['abstract_unix_socket', 'signal'] : [],
        tsync: abi >= 8,
        fail_closed_above_abi: 8,
      },
      seccomp: {
        policy: 'lamina.landlock-candidate-seccomp/x86_64-v2',
        architecture: 'x86_64',
        unsupported_architecture_action: 'compile_refusal',
        kernel_install_failure_action: 'launch_refusal',
        denied_errno: 'EPERM',
        inherited_across_exec: true,
        native_self_tests: [
          'writable-fd-fchmod:EPERM', 'memfd_create:EPERM',
          'valid-regular-fd-ioctl:pre-non-EPERM/post-EPERM',
          'valid-regular-fd-TCGETS2:post-non-EPERM',
          'valid-regular-fd-removexattrat:pre-ENODATA/post-EPERM',
          'fork:EPERM', 'clone3:ENOSYS', 'socket:EPERM', 'socketpair:EPERM',
        ],
        process_creation: {
          fork: 'EPERM',
          vfork: 'EPERM',
          clone3: 'ENOSYS (forces pthread fallback to reviewed legacy clone)',
          clone: 'allowed only when CLONE_THREAD is set; otherwise EPERM',
        },
        raw_ioctl: {
          default_action: 'EPERM',
          allowed_requests: [
            'x86_64 TCGETS (0x5401)', 'x86_64 TCGETS2 (0x802c542a)',
            'x86_64 FIONBIO (0x5421)',
          ],
          compatibility_reason:
            'Node v24 probes inherited stdio and makes pipe stdout nonblocking before user code',
          denial_self_test: 'valid regular FD FIONREAD returns EPERM',
        },
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
