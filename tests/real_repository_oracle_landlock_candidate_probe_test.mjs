#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterProbe } from '../scripts/safe-runner/adapter.mjs';
import { infrastructureBinaries } from '../scripts/safe-runner/infrastructure.mjs';
import {
  LANDLOCK_CANDIDATE_PROBE_LAUNCH_PROFILE,
  LANDLOCK_CANDIDATE_PROBE_WORKLOAD_ID,
} from '../scripts/safe-runner/landlock-candidate-profile.mjs';
import { runSafely } from '../scripts/safe-runner/runner.mjs';
import { promotionStatus } from '../scripts/safe-runner/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = path.join(ROOT, 'tests/fixtures/safe-runner-landlock-probe.mjs');
const LAUNCHER_SOURCE = path.join(
  ROOT, 'benchmarks/real-repository-oracle-v1/landlock-candidate-launcher.c',
);

if (process.platform !== 'linux') {
  console.log('real repository oracle Landlock candidate probe skipped outside Linux');
  process.exit(0);
}
try { infrastructureBinaries(); } catch (error) {
  if (error?.code !== 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY') throw error;
  console.log(`real repository oracle Landlock candidate probe skipped: ${error.message}`);
  process.exit(0);
}
const adapter = adapterProbe();
if (adapter.id !== 'linux-systemd-cgroup-v2' || adapter.production_enforcement !== true) {
  console.log('real repository oracle Landlock candidate probe skipped: production scope unavailable');
  process.exit(0);
}

const reportRoot = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-landlock-candidate-probe-test-'),
));
fs.chmodSync(reportRoot, 0o700);
const previousStateDirectory = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(reportRoot, 'state');
let liveAbi = null;
try {
  const report = await runSafely({
    command: [process.execPath, PROBE],
    tier: 'small', cwd: ROOT, reportFile: path.join(reportRoot, 'report.json'),
    workloadId: LANDLOCK_CANDIDATE_PROBE_WORKLOAD_ID,
    overrides: {
      memoryMaxBytes: 256 * 1024 ** 2,
      memoryHighBytes: 192 * 1024 ** 2,
      pidsMax: 32,
      timeoutMs: 10_000,
      tempMaxBytes: 64 * 1024 ** 2,
      outputMaxBytes: 1024 * 1024,
    },
  });
  assert.equal(report.outcome, 'success', JSON.stringify({
    error: report.error, output: report.output,
  }));
  assert.equal(report.output.stderr_bytes, 0);
  assert.equal(report.preflight.launch_profile, LANDLOCK_CANDIDATE_PROBE_LAUNCH_PROFILE);
  assert.equal(report.preflight.execution_snapshot.launch_profile,
    LANDLOCK_CANDIDATE_PROBE_LAUNCH_PROFILE);
  const result = JSON.parse(report.output.stdout_tail.trim());
  liveAbi = result.landlock.abi;
  assert.equal(result.schema, 'lamina.safe-runner-landlock-candidate-probe/v2');
  assert.equal(result.non_gradeable, true);
  assert.equal(result.cleanup_proof_issued, false);
  assert.equal(result.grading_reachable, false);
  assert.equal(result.candidate_executed, false);
  assert.equal(result.adversarial_probe_executed, true);
  assert.deepEqual(result.outer_context, {
    generic_safe_runner: true,
    systemd_cgroup: true,
    user_namespace: true,
    pid_namespace: true,
    network_namespace: true,
    bounded_tmpfs: true,
    control_sockets_masked: true,
  });
  assert.equal(result.landlock.reviewed_uapi, 'linux-v7.0');
  assert.ok(result.landlock.abi >= 3 && result.landlock.abi <= 8);
  assert.deepEqual(result.landlock.base_rights, [
    'execute', 'write_file', 'read_file', 'read_dir', 'remove_dir', 'remove_file',
    'make_char', 'make_dir', 'make_reg', 'make_sock', 'make_fifo', 'make_block',
    'make_sym', 'refer', 'truncate',
  ]);
  if (result.landlock.abi >= 5) assert.ok(result.landlock.handled_rights.includes('ioctl_dev'));
  if (result.landlock.abi >= 6) assert.deepEqual(result.landlock.scopes,
    ['abstract_unix_socket', 'signal']);
  assert.equal(result.landlock.fail_closed_above_abi, 8);
  assert.equal(result.seccomp.policy, 'lamina.landlock-candidate-seccomp/x86_64-v2');
  assert.equal(result.seccomp.architecture, 'x86_64');
  assert.equal(result.seccomp.unsupported_architecture_action, 'compile_refusal');
  assert.equal(result.seccomp.kernel_install_failure_action, 'launch_refusal');
  assert.equal(result.seccomp.denied_errno, 'EPERM');
  assert.equal(result.seccomp.inherited_across_exec, true);
  assert.deepEqual(result.seccomp.native_self_tests,
    [
      'writable-fd-fchmod:EPERM', 'memfd_create:EPERM',
      'valid-regular-fd-ioctl:pre-non-EPERM/post-EPERM',
      'valid-regular-fd-TCGETS2:post-non-EPERM',
      'valid-regular-fd-removexattrat:pre-ENODATA/post-EPERM',
      'fork:EPERM', 'clone3:ENOSYS', 'socket:EPERM', 'socketpair:EPERM',
    ]);
  for (const syscall of [
    'chmod', 'fchmod', 'fchmodat', 'fchmodat2', 'chown', 'fchown', 'lchown',
    'fchownat', 'utime', 'utimes', 'futimesat', 'utimensat', 'setxattr',
    'lsetxattr', 'fsetxattr', 'removexattr', 'lremovexattr', 'fremovexattr',
    'setxattrat', 'removexattrat', 'file_setattr',
  ]) assert.ok(result.seccomp.denied_syscall_classes.persistent_metadata.includes(syscall));
  assert.deepEqual(result.seccomp.denied_syscall_classes.process_creation, ['fork', 'vfork']);
  assert.deepEqual(result.seccomp.process_creation, {
    fork: 'EPERM',
    vfork: 'EPERM',
    clone3: 'ENOSYS (forces pthread fallback to reviewed legacy clone)',
    clone: 'allowed only when CLONE_THREAD is set; otherwise EPERM',
  });
  assert.deepEqual(result.seccomp.raw_ioctl, {
    default_action: 'EPERM',
    allowed_requests: [
      'x86_64 TCGETS (0x5401)', 'x86_64 TCGETS2 (0x802c542a)',
      'x86_64 FIONBIO (0x5421)',
    ],
    compatibility_reason:
      'Node v24 probes inherited stdio and makes pipe stdout nonblocking before user code',
    denial_self_test: 'valid regular FD FIONREAD returns EPERM',
  });
  assert.deepEqual(result.seccomp.denied_syscall_classes.anonymous_executable,
    ['memfd_create']);
  assert.deepEqual(result.seccomp.denied_syscall_classes.network_creation,
    ['socket', 'socketpair']);
  const reportedDeniedSyscalls = Object.values(result.seccomp.denied_syscall_classes)
    .flat().sort();
  const sourceDeniedSyscalls = [...fs.readFileSync(LAUNCHER_SOURCE, 'utf8')
    .matchAll(/\bDENY_SYSCALL\(([a-zA-Z0-9_]+)\)/g)]
    .map((match) => match[1]).filter((name) => name !== 'name').sort();
  assert.deepEqual(reportedDeniedSyscalls, sourceDeniedSyscalls);
  const launcherSource = fs.readFileSync(LAUNCHER_SOURCE, 'utf8');
  assert.match(launcherSource, /offsetof\(struct seccomp_data, args\[0\]\)/);
  assert.match(launcherSource, /BPF_ALU \| BPF_AND \| BPF_K, CLONE_THREAD/);
  assert.match(launcherSource, /__NR_clone3[\s\S]{0,200}ENOSYS/);
  assert.match(launcherSource, /__NR_ioctl[\s\S]{0,300}REVIEWED_X86_64_TCGETS2/);
  assert.equal(result.build.source_fd_pinned, true);
  assert.equal(result.build.output_anonymous, true);
  assert.equal(result.build.output_reopened_read_only, true);
  assert.equal(result.build.writable_output_fd_closed_before_exec, true);
  assert.match(result.build.source_sha256, /^[a-f0-9]{64}$/);
  assert.match(result.build.output_sha256, /^[a-f0-9]{64}$/);
  const compilerPath = fs.realpathSync.native('/usr/bin/cc');
  assert.equal(fs.statSync(compilerPath).uid, 0);
  assert.equal(result.build.compiler.path, compilerPath);
  assert.equal(result.build.compiler.sha256, crypto.createHash('sha256')
    .update(fs.readFileSync(compilerPath)).digest('hex'));
  assert.ok(result.build.compiler_toolchain.length >= 3);
  for (const tool of result.build.compiler_toolchain) {
    assert.equal(fs.statSync(tool.path).uid, 0);
    assert.equal(tool.sha256, crypto.createHash('sha256')
      .update(fs.readFileSync(tool.path)).digest('hex'));
    assert.equal(tool.mode & 0o022, 0);
  }
  assert.match(result.build.compiler_identity_scope, /^partial root-owned executable evidence;/);
  const configurationPath = fs.realpathSync.native('/etc/ssl/openssl.cnf');
  assert.equal(result.build.runtime_configuration.path, configurationPath);
  assert.deepEqual(result.build.runtime_configuration.allowed_rights, ['read_file']);
  assert.equal(result.build.runtime_configuration.sha256, crypto.createHash('sha256')
    .update(fs.readFileSync(configurationPath)).digest('hex'));
  assert.equal(result.candidate.identity_exact, true);
  assert.equal(result.candidate.exit_code, 0);
  assert.equal(result.candidate.signal, null);
  assert.deepEqual(result.candidate.descendants_remaining, []);
  assert.equal(result.candidate.filesystem_side_effects_absent, true);
  assert.deepEqual(result.candidate.result, {
    schema: 'lamina.landlock-candidate-adversary-result/v2',
    input_token: 'public-token',
    repository_text: 'repository-visible\n',
    scratch_written: true,
    hidden_read_refused: true,
    repository_mutation_refused: true,
    elsewhere_write_refused: true,
    proc_read_refused: true,
    command_line_controller_paths_absent: true,
    high_inherited_fd_closed: true,
    control_socket_refused: true,
    tcp_socket_refused: true,
    udp_socket_refused: true,
    extra_executable_path_refused: true,
    file_mode_mutation_refused: true,
    directory_mode_mutation_refused: true,
    file_owner_mutation_refused: true,
    directory_owner_mutation_refused: true,
    file_time_mutation_refused: true,
    directory_time_mutation_refused: true,
    metadata_denial_codes: {
      file_mode: 'EPERM', directory_mode: 'EPERM',
      file_owner: 'EPERM', directory_owner: 'EPERM',
      file_time: 'EPERM', directory_time: 'EPERM',
    },
    child_process_spawn_refused: true,
    child_process_denial_code: 'EPERM',
    child_process_spawned_pid: null,
  });
  assert.equal(result.candidate.repository_manifest_equal, true);
  assert.match(result.candidate.repository_manifest_before_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.candidate.repository_manifest_after_sha256,
    result.candidate.repository_manifest_before_sha256);
  assert.deepEqual(result.candidate.repository_manifest_fields, [
    'dev', 'ino', 'mode', 'uid', 'gid', 'mtime_ns', 'ctime_ns',
    'directory_entries', 'file_content_sha256',
  ]);
  assert.equal(result.candidate.private_pid_namespace_rescan_verified, true);
  assert.equal(result.candidate.private_pid_namespace_expected_identities.length, 2);
  assert.deepEqual(result.candidate.private_pid_namespace_observed_identities,
    result.candidate.private_pid_namespace_expected_identities);
  assert.ok(result.candidate.private_pid_namespace_rescan_attempts >= 1);
  assert.deepEqual(result.candidate.unexpected_private_pid_identities, []);
  assert.deepEqual(result.probe_temp_entries_after_cleanup, []);
  assert.equal(report.cleanup.scope_removed, true);
  assert.equal(report.cleanup.temporary_directory_removed, true);
  assert.deepEqual(report.cleanup.descendants_remaining, []);
  assert.deepEqual(report.cleanup.errors, []);

  const promotionReport = await runSafely({
    command: [process.execPath, PROBE], tier: 'small', cwd: ROOT,
    reportFile: path.join(reportRoot, 'promotion-report.json'),
    workloadId: LANDLOCK_CANDIDATE_PROBE_WORKLOAD_ID, promote: true,
    overrides: {
      memoryMaxBytes: 256 * 1024 ** 2, memoryHighBytes: 192 * 1024 ** 2,
      pidsMax: 32, timeoutMs: 10_000, tempMaxBytes: 64 * 1024 ** 2,
      outputMaxBytes: 1024 * 1024,
    },
  });
  assert.equal(promotionReport.outcome, 'preflight_refused');
  assert.match(promotionReport.error.message, /cannot be promoted/);

  const cliReportFile = path.join(reportRoot, 'cli-promotion-report.json');
  const cli = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/safe-runner/cli.mjs'), 'run', '--tier', 'small',
    '--workload', LANDLOCK_CANDIDATE_PROBE_WORKLOAD_ID,
    '--report', cliReportFile, '--memory-mib', '256', '--memory-high-mib', '192',
    '--pids', '32', '--timeout-ms', '10000', '--temporary-mib', '64',
    '--output-mib', '1', '--promote', '--', process.execPath, PROBE,
  ], { cwd: ROOT, encoding: 'utf8', env: process.env });
  assert.equal(cli.status, 2, `${cli.stdout}\n${cli.stderr}`);
  const cliReport = JSON.parse(fs.readFileSync(cliReportFile, 'utf8'));
  assert.equal(cliReport.outcome, 'preflight_refused');
  assert.match(cliReport.error.message, /cannot be promoted/);
  assert.deepEqual(promotionStatus(ROOT, LANDLOCK_CANDIDATE_PROBE_WORKLOAD_ID), {
    completed: [], value: null,
  });
} finally {
  if (previousStateDirectory === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousStateDirectory;
  fs.rmSync(reportRoot, { recursive: true, force: true });
}

console.log(`real repository oracle Landlock candidate probe passed (ABI ${liveAbi})`);
