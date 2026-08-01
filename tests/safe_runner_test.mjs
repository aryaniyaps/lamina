#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { adapterProbe, assertAdapterShape, boundedProbeFailure } from '../scripts/safe-runner/adapter.mjs';
import { authorizeBrokerRequest, createProofBroker } from '../scripts/safe-runner/broker.mjs';
import { DEFAULTS, GIB, MIB, SELF_TEST_CASE_IDS } from '../scripts/safe-runner/constants.mjs';
import { safeRunnerContext } from '../scripts/safe-runner/context.mjs';
import {
  deriveLimits,
  parseHostPageSize,
  validateLimitOverrides,
} from '../scripts/safe-runner/envelope.mjs';
import { ownedDirectoryIdentity, removeOwnedDirectory } from '../scripts/safe-runner/filesystem.mjs';
import {
  assertSystemctlSuccess,
  cgroupResolutionState,
  LinuxSystemdAdapter,
  parseSystemdMajor,
  SYSTEMCTL_CONTROL_TIMEOUT_MS,
  SYSTEMCTL_READBACK_TIMEOUT_MS,
  systemdAbsenceProof,
  systemdKillArguments,
  systemdScopeProperties,
} from '../scripts/safe-runner/linux-systemd.mjs';
import {
  classifyRemainingDescendants,
  registeredManagedGraphd,
} from '../scripts/safe-runner/managed-descendants.mjs';
import {
  authorizeManagedObjects, bindManagedObjects, lstatPresence, removeManagedObjects, reserveManagedObjects,
  sealManagedObjects,
} from '../scripts/safe-runner/managed-paths.mjs';
import {
  assertTrustedBinaryIdentity, isExecutionHookEnvironment, sanitizedEnvironment,
  trustedBinaryIdentity,
} from '../scripts/safe-runner/infrastructure.mjs';
import { commandOwnership, preflightRun, writableWorktreeProof } from '../scripts/safe-runner/preflight.mjs';
import { existingLaminaProcesses, isLaminaProcessCommand } from '../scripts/safe-runner/processes.mjs';
import {
  assertExecutionSnapshot, prepareExecutionSnapshot,
} from '../scripts/safe-runner/execution-snapshot.mjs';
import { redactCommand, redactEvidence, redactText } from '../scripts/safe-runner/redaction.mjs';
import { stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
import {
  baseReport,
  finishReport,
  prepareReportAuthority,
  validateReport,
  writeReport,
  writeReportWithFallback,
} from '../scripts/safe-runner/report.mjs';
import {
  boundedDiagnosticText, closeOutputStreams, outcomeForStop, releaseFifo,
} from '../scripts/safe-runner/runner.mjs';
import {
  bubblewrapSandboxArguments,
  CONTROL_ENVIRONMENT_NAMES,
  controlSocketMasks,
} from '../scripts/safe-runner/sandbox.mjs';
import { boundedCaseError, runAdversarialSelfTests } from '../scripts/safe-runner/self-test.mjs';
import {
  acquireConcurrencyLock,
  beginSafetyAttempt,
  checkPromotion,
  checkSafetyRetry,
  clearSafetyAttempt,
  frozenWorkloadIdentity,
  readAttestation,
  recordPromotion,
  recordSafetyLimit,
  productionLockDirectory,
  promotionCommandDigest,
  repositorySourceDigest,
  writeAttestation,
} from '../scripts/safe-runner/state.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-unit-'));
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'state');

try {
  const ownedTemporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-owned-'));
  const ownedIdentity = ownedDirectoryIdentity(ownedTemporary);
  assert.equal(removeOwnedDirectory(ownedTemporary, 'lamina-safe-runner-', ownedIdentity), true);
  const nonClosingChild = {
    resumed: false, destroyed: false,
    resume() { this.resumed = true; }, destroy() { this.destroyed = true; },
  };
  const nonClosingSink = {
    closed: false, destroyed: false,
    once() {}, on() {},
    end() {}, destroy() { this.destroyed = true; },
  };
  const outputCloseStarted = Date.now();
  assert.equal(await closeOutputStreams([nonClosingChild], [nonClosingSink], 25), false);
  assert.ok(Date.now() - outputCloseStarted < 500);
  assert.equal(nonClosingChild.resumed, true);
  assert.equal(nonClosingChild.destroyed, true);
  assert.equal(nonClosingSink.destroyed, true);
  const readerlessFifo = path.join(root, 'readerless.fifo');
  assert.equal(spawnSync('/usr/bin/mkfifo', ['-m', '600', readerlessFifo]).status, 0);
  const fifoStarted = Date.now();
  await assert.rejects(() => releaseFifo(readerlessFifo, 25), /no live reader/);
  assert.ok(Date.now() - fifoStarted < 500,
    'a dead wrapper must not leave the controller blocked opening its release FIFO');
  const replacedTemporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-replaced-'));
  const replacedIdentity = ownedDirectoryIdentity(replacedTemporary);
  fs.renameSync(replacedTemporary, `${replacedTemporary}-original`);
  fs.mkdirSync(replacedTemporary);
  assert.throws(
    () => removeOwnedDirectory(replacedTemporary, 'lamina-safe-runner-', replacedIdentity),
    /ownership identity changed/,
  );
  assert.equal(fs.existsSync(replacedTemporary), true);
  fs.rmSync(replacedTemporary, { recursive: true });
  fs.rmSync(`${replacedTemporary}-original`, { recursive: true });
  const eightGib = deriveLimits({}, { totalMemoryBytes: 8 * GIB });
  assert.equal(eightGib.memory_max_bytes, 2 * GIB);
  assert.equal(eightGib.memory_high_bytes, Math.floor(1.6 * GIB));
  assert.equal(eightGib.memory_page_bytes, null);
  assert.equal(eightGib.pids_max, 64);
  assert.equal(eightGib.concurrency, 1);
  assert.ok(eightGib.minimum_free_disk_bytes >= 5 * GIB);
  for (const invalid of [NaN, Infinity, 0, -1, 1.5]) {
    assert.throws(() => validateLimitOverrides({ pidsMax: invalid }), /finite positive integer/);
  }
  assert.throws(() => deriveLimits({ unknownLimit: 1 }), /unknown safe-runner limit override/);
  const aligned192Mib = deriveLimits({
    memoryMaxBytes: 192 * MIB,
    memoryHighBytes: 160 * MIB,
  }, {
    totalMemoryBytes: 8 * GIB,
    pageSizeBytes: 4_096,
  });
  assert.equal(aligned192Mib.memory_max_bytes, 201_326_592);
  assert.equal(aligned192Mib.memory_high_bytes, 161_058_816);
  assert.equal(aligned192Mib.memory_page_bytes, 4_096);
  assert.ok(aligned192Mib.memory_high_bytes < aligned192Mib.memory_max_bytes);
  assert.equal(parseHostPageSize('KernelPageSize:        4 kB\n', {
    productionEnforcement: true,
  }), 4_096);
  assert.equal(parseHostPageSize('unavailable', {
    productionEnforcement: false,
  }), null);
  assert.throws(() => parseHostPageSize('unavailable', {
    productionEnforcement: true,
  }), (error) => error.code === 'LAMINA_SAFE_PAGE_SIZE_UNPROVEN');
  assert.throws(() => deriveLimits({ memoryMaxBytes: 4_096 }, {
    totalMemoryBytes: 8 * GIB,
    pageSizeBytes: 4_096,
  }), /lower than memoryMaxBytes/);

  const portableProbe = {
    id: 'portable-process-group-small-only',
    platform: 'darwin',
    production_enforcement: false,
    aggregate_memory: false,
    aggregate_pids: false,
    complete_descendant_ownership: false,
    controllers: [],
    reasons: ['unsupported'],
  };
  assert.equal(writableWorktreeProof('/').ok, false);
  assert.equal(writableWorktreeProof('/tmp').ok, false);
  assert.equal(writableWorktreeProof(process.cwd(), [path.join(process.cwd(), '.runner-authority')]).ok, false);
  const worktreeSymlink = path.join(root, 'worktree-link');
  fs.symlinkSync(process.cwd(), worktreeSymlink);
  assert.equal(writableWorktreeProof(worktreeSymlink, []).ok, false);
  for (const unsafeCwd of ['/', '/tmp']) {
    const unsafeWritable = preflightRun({
      tier: 'small',
      command: [process.execPath, path.resolve('tests/fixtures/safe-runner-adversary.mjs'), 'success'],
      cwd: unsafeCwd,
      adapterInfo: { ...portableProbe, id: 'unit-production', production_enforcement: true },
      injectedExistingProcesses: [],
    });
    assert.equal(unsafeWritable.ok, false);
    assert.match(unsafeWritable.reasons.join('\n'), /host-sensitive root/);
  }
  const masks = controlSocketMasks({
    uid: 1234,
    env: {
      DOCKER_HOST: 'unix:///custom/docker.sock',
      DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/custom/system-bus,guid=abc',
      DBUS_SESSION_BUS_ADDRESS: 'unix:abstract=/cannot-bind',
    },
    directoryExists: (candidate) => candidate === '/run/user/1234',
    socketExists: (candidate) => [
      '/run/systemd/private', '/custom/docker.sock', '/custom/system-bus',
    ].includes(candidate),
  });
  assert.deepEqual(masks.hiddenDirectories, ['/run/user/1234']);
  assert.deepEqual(masks.sockets, [
    '/run/systemd/private', '/custom/system-bus', '/custom/docker.sock',
  ]);
  const sandboxArgs = bubblewrapSandboxArguments({
    cwd: root,
    readyFile: path.join(root, 'quota.ready'),
    releaseFile: path.join(root, 'quota.release'),
    temporaryDirectory: path.join(root, 'payload-tmp'),
    command: ['node', 'tiny.mjs'],
    masks,
  });
  assert.ok(sandboxArgs.includes('/run/user/1234'));
  assert.ok(sandboxArgs.includes('/run/systemd/private'));
  assert.ok(sandboxArgs.includes('/custom/docker.sock'));
  assert.ok(sandboxArgs.includes('--unshare-pid'));
  assert.ok(sandboxArgs.includes('--unshare-net'));
  for (const name of CONTROL_ENVIRONMENT_NAMES) {
    const index = sandboxArgs.indexOf(name);
    assert.equal(sandboxArgs[index - 1], '--unsetenv');
  }
  const authorityArgs = bubblewrapSandboxArguments({
    cwd: root,
    readyFile: path.join(root, 'quota.ready'),
    releaseFile: path.join(root, 'quota.release'),
    temporaryDirectory: path.join(root, 'payload-tmp'),
    command: ['node', 'tiny.mjs'], masks: { hiddenDirectories: [], sockets: [] },
    executionAuthority: {
      repository: root,
      snapshot_repository: path.join(root, 'execution-authority', 'repository'),
      writable_bindings: [{
        source: path.join(root, 'dist'), target: path.join(root, 'dist'),
        alias: path.join(root, 'execution-authority', 'writable-aliases', '0'),
      }],
    },
  });
  const repositoryMount = authorityArgs.indexOf(path.join(root, 'execution-authority', 'repository'));
  assert.equal(authorityArgs[repositoryMount - 1], '--ro-bind');
  assert.ok(authorityArgs.indexOf(path.join(root, 'execution-authority', 'writable-aliases', '0'))
    < repositoryMount, 'writable source aliases must be captured before the logical cwd is frozen');
  for (const name of [
    'BASH_FUNC_payload%%', 'LD_DEBUG_OUTPUT', 'NODE_V8_COVERAGE',
    'NODE_COMPILE_CACHE', 'NODE_REDIRECT_WARNINGS', 'DYLD_INSERT_LIBRARIES',
  ]) assert.equal(isExecutionHookEnvironment(name), true, name);
  const poison = sanitizedEnvironment({
    SAFE_VALUE: 'kept', LD_DEBUG_OUTPUT: '/tmp/ld', NODE_V8_COVERAGE: '/tmp/v8',
    NODE_COMPILE_CACHE: '/tmp/cache', NODE_REDIRECT_WARNINGS: '/tmp/warnings',
    'BASH_FUNC_payload%%': '() { touch /tmp/pwned; }',
  });
  assert.equal(poison.SAFE_VALUE, 'kept');
  for (const name of [
    'LD_DEBUG_OUTPUT', 'NODE_V8_COVERAGE', 'NODE_COMPILE_CACHE',
    'NODE_REDIRECT_WARNINGS', 'BASH_FUNC_payload%%',
  ]) assert.equal(poison[name], undefined, name);

  const binaryCopy = path.join(root, 'trusted-bwrap-copy');
  fs.copyFileSync('/usr/bin/bwrap', binaryCopy);
  fs.chmodSync(binaryCopy, 0o755);
  const binaryIdentity = trustedBinaryIdentity(binaryCopy);
  assert.equal(assertTrustedBinaryIdentity(binaryIdentity).path, binaryCopy);
  fs.appendFileSync(binaryCopy, 'changed');
  assert.throws(() => assertTrustedBinaryIdentity(binaryIdentity), /digest mismatch|identity changed/);
  assert.equal(adapterProbe('darwin').production_enforcement, false);
  assert.equal(adapterProbe('win32').id, 'portable-process-group-small-only');
  assert.equal(
    boundedProbeFailure({ status: 1, signal: null, stderr: `denied\n${'x'.repeat(1_000)}` }),
    `exit=1; output=${`denied ${'x'.repeat(1_000)}`.slice(0, 500)}`,
  );
  const ordinarySmall = preflightRun({
    tier: 'small', command: ['node', '-e', ''], cwd: root, adapterInfo: portableProbe,
  });
  assert.equal(ordinarySmall.ok, false);
  assert.match(ordinarySmall.reasons.join('\n'), /only the built-in deliberately tiny self-test/);
  const portableSelfTest = preflightRun({
    tier: 'small',
    command: [process.execPath, path.join(process.cwd(), 'tests/fixtures/safe-runner-adversary.mjs'), 'success'],
    cwd: root,
    adapterInfo: portableProbe,
    mode: 'self-test',
    selfTestCaseId: 'normal_cleanup',
    overrides: {
      memoryMaxBytes: 64 * MIB,
      timeoutMs: 1_000,
      pidsMax: 8,
      outputMaxBytes: 64 * 1024,
      tempMaxBytes: 1 * MIB,
    },
  });
  assert.equal(portableSelfTest.deliberately_tiny_self_test, true);
  assert.equal(portableSelfTest.portable_self_test_allowed, true);
  assert.doesNotMatch(portableSelfTest.reasons.join('\n'), /only the built-in deliberately tiny self-test/);
  const unsafePortable = preflightRun({
    tier: 'small',
    command: [process.execPath, path.join(process.cwd(), 'tests/fixtures/safe-runner-adversary.mjs'), 'detached-child'],
    cwd: root,
    adapterInfo: portableProbe,
    mode: 'self-test',
    selfTestCaseId: 'detached_descendant',
    overrides: {
      memoryMaxBytes: 64 * MIB, timeoutMs: 1_000, pidsMax: 8,
      outputMaxBytes: 64 * 1024, tempMaxBytes: 1 * MIB,
    },
  });
  assert.equal(unsafePortable.ok, false);
  assert.equal(unsafePortable.portable_self_test_allowed, false);
  const productionPortable = preflightRun({
    tier: 'medium', command: ['node', '-e', ''], cwd: root, adapterInfo: portableProbe,
  });
  assert.equal(productionPortable.ok, false);
  assert.match(productionPortable.reasons.join('\n'), /medium\/large execution requires Linux/);
  const portableQualification = await runAdversarialSelfTests({ cwd: root, probe: portableProbe });
  assert.equal(portableQualification.passed, false);
  assert.equal(portableQualification.qualified_for_production_tiers, false);
  assert.match(portableQualification.refusal.message, /requires Linux user-systemd cgroup-v2/);
  assert.equal(portableQualification.cases.length, SELF_TEST_CASE_IDS.length);
  assert.ok(portableQualification.cases.every((item) => item.skipped === true));
  assert.equal(commandOwnership(['harbor', 'run']).proven, false);
  assert.equal(commandOwnership(['/bin/sh', '-c', 'docker run image']).proven, false);
  assert.equal(commandOwnership(['npm', 'exec', '--', 'podman', 'run']).proven, false);
  const wrapper = path.join(root, 'wrapper.sh');
  fs.writeFileSync(wrapper, '#!/bin/sh\nexec harbor run "$@"\n');
  assert.equal(commandOwnership(['/bin/sh', wrapper], root).proven, false);
  assert.equal(commandOwnership(['node', 'benchmarks/lb6/pilot/scripts/run-three-arm.mjs']).proven, false);
  assert.equal(commandOwnership(['node', 'tests/tiny.mjs']).proven, false);
  const arbitraryWrapper = path.join(root, 'arbitrary-wrapper.mjs');
  fs.writeFileSync(arbitraryWrapper, 'import { spawn } from "node:child_process"; spawn("systemd-run", []);\n');
  assert.equal(commandOwnership([process.execPath, arbitraryWrapper], root).proven, false);
  assert.match(commandOwnership([process.execPath, arbitraryWrapper], root).reason, /explicitly audited/);
  assert.equal(commandOwnership([
    process.execPath, path.resolve('evals/scripts/vendor-plane-fixture.mjs'),
  ], root).proven, true);
  assert.equal(commandOwnership([
    process.execPath, path.resolve('evals/scripts/vendor-plane-fixture.mjs'),
  ], root).network_access, 'audited-required');
  assert.equal(commandOwnership([
    process.execPath, path.resolve('tests/fixtures/safe-runner-adversary.mjs'), 'success',
  ], root).network_access, 'isolated');
  const unsealedRetrievalRuntime = preflightRun({
    tier: 'small', cwd: process.cwd(), adapterInfo: portableProbe,
    command: [process.execPath, path.resolve('benchmarks/retrieval-v1/benchmark.mjs'), '--evaluate'],
  });
  assert.match(unsealedRetrievalRuntime.reasons.join('\n'),
    /requires --worker.*uv\/\.venv execution is outside sealed execution authority/);
  const unsealedEvalRuntime = preflightRun({
    tier: 'small', cwd: process.cwd(), adapterInfo: portableProbe,
    command: [process.execPath, path.resolve('evals/scripts/run-suite.mjs'), '--smoke'],
  });
  assert.match(unsealedEvalRuntime.reasons.join('\n'),
    /ignored \.venv-eval runtime.*not admitted into sealed execution authority/);
  for (const entrypoint of [
    'scripts/build-standalone-cli.mjs', 'scripts/fetch-retrieval-model.mjs',
    'scripts/prepare-retrieval-assets.mjs', 'tests/retrieval_native_index_test.mjs',
    'tests/cli_binary_smoke_test.mjs',
  ]) {
    assert.equal(commandOwnership([process.execPath, path.resolve(entrypoint)], root).proven, true,
      `${entrypoint} must remain available through the canonical wrapper`);
  }
  assert.equal(commandOwnership([
    process.execPath, '--require', path.resolve('evals/scripts/vendor-plane-fixture.mjs'),
    '--eval', 'require("node:child_process").spawn("systemd-run", [])',
  ], root).proven, false);
  assert.equal(commandOwnership([
    'npx', '-p', 'promptfoo', 'node', arbitraryWrapper,
  ], root).proven, false);
  const substitutedBin = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-bin-'));
  const substitutedNode = path.join(substitutedBin, 'node');
  const substitutedNpx = path.join(substitutedBin, 'npx');
  fs.symlinkSync('/bin/sh', substitutedNode);
  fs.symlinkSync(process.execPath, substitutedNpx);
  assert.equal(commandOwnership([
    substitutedNode, path.resolve('evals/scripts/vendor-plane-fixture.mjs'),
  ], root).proven, false);
  assert.equal(commandOwnership([
    substitutedNpx, 'promptfoo', 'eval', '-c', 'evals/promptfoo/lamina-redteam.yaml',
  ], root).proven, false);
  const allowedSymlink = path.join(root, 'vendor-plane-link.mjs');
  fs.symlinkSync(path.resolve('evals/scripts/vendor-plane-fixture.mjs'), allowedSymlink);
  assert.equal(commandOwnership([process.execPath, allowedSymlink], root).proven, false);
  assert.deepEqual(redactCommand(['tool', '--token', 'secret-value', '--api-key=abc']), [
    'tool', '--token', '[REDACTED]', '--api-key=[REDACTED]',
  ]);
  assert.equal(redactText('Authorization: Bearer abc.def'), 'Authorization: Bearer [REDACTED]');
  const recursivelyRedacted = redactEvidence({
    post_lock_existing_lamina_processes: [{
      command: 'tool --token process-secret',
      nested: { api_key: 'nested-secret' },
    }],
    detached_descendant_observation: {
      unmanaged: [{ command: 'Authorization: Bearer descendant-secret' }],
    },
  });
  assert.doesNotMatch(JSON.stringify(recursivelyRedacted), /process-secret|nested-secret|descendant-secret/);
  const externalSmall = preflightRun({
    tier: 'small', command: ['docker', 'run', 'tiny'], cwd: root,
  });
  assert.equal(externalSmall.ok, false);
  assert.match(externalSmall.reasons.join('\n'), /external daemon/);

  const report = finishReport(baseReport({
    tier: 'small', command: ['node', '-e', ''], cwd: root,
  }), Date.now());
  report.report_file = path.join(root, 'report.json');
  report.outcome = 'success';
  report.adapter = portableProbe;
  report.limits = eightGib;
  report.preflight = { ok: true };
  report.samples.push({
    elapsed_ms: 0,
    aggregate_rss_bytes: 0,
    cgroup_memory_bytes: 0,
    pids: 0,
    temporary_bytes: 0,
    temporary_inodes: 0,
  });
  report.termination.reason = 'completed';
  report.cleanup.attempted = true;
  report.cleanup.descendants_remaining = [];
  report.cleanup.scope_removed = true;
  report.cleanup.temporary_directory_removed = true;
  const reportValidation = validateReport(report);
  assert.equal(reportValidation.valid, true, reportValidation.errors.join('; '));
  writeReport(report.report_file, report);
  assert.equal(validateReport(JSON.parse(fs.readFileSync(report.report_file))).valid, true);
  const reportAuthority = path.join(root, 'report-authority.json');
  const provisional = { ...structuredClone(report), report_file: reportAuthority,
    outcome: 'internal_error', termination: { ...report.termination, reason: 'run_in_progress' },
    error: { code: 'LAMINA_SAFE_RUN_IN_PROGRESS', message: 'not complete' } };
  const preparedReportAuthority = prepareReportAuthority(reportAuthority, provisional);
  assert.equal(preparedReportAuthority.file, reportAuthority);
  const reportTarget = path.join(root, 'report-target.json');
  fs.writeFileSync(reportTarget, 'preserve');
  const reportSymlink = path.join(root, 'report-symlink.json');
  fs.symlinkSync(reportTarget, reportSymlink);
  const symlinkAuthority = prepareReportAuthority(reportSymlink,
    { ...provisional, report_file: reportSymlink });
  assert.equal(symlinkAuthority.file_identity.nlink, 1);
  assert.equal(fs.lstatSync(reportSymlink).isSymbolicLink(), false,
    'slot acquisition must atomically replace, never follow, a stale symlink');
  assert.equal(fs.readFileSync(reportTarget, 'utf8'), 'preserve');
  const hardlinkVictim = path.join(root, 'report-hardlink-victim.json');
  const hardlinkSlot = path.join(root, 'report-hardlink.json');
  fs.writeFileSync(hardlinkVictim, 'hardlink victim must survive');
  fs.linkSync(hardlinkVictim, hardlinkSlot);
  const hardlinkAuthority = prepareReportAuthority(hardlinkSlot,
    { ...provisional, report_file: hardlinkSlot });
  assert.equal(hardlinkAuthority.file_identity.nlink, 1);
  assert.equal(fs.readFileSync(hardlinkVictim, 'utf8'), 'hardlink victim must survive',
    'slot acquisition must never truncate through a hardlink');
  const copiedAuthority = prepareReportAuthority(path.join(root, 'copied-authority.json'),
    { ...provisional, report_file: path.join(root, 'copied-authority.json') });
  const copiedBytes = fs.readFileSync(copiedAuthority.file);
  fs.unlinkSync(copiedAuthority.file);
  fs.writeFileSync(copiedAuthority.file, copiedBytes, { mode: 0o600 });
  assert.throws(() => writeReport(copiedAuthority.file,
    { ...report, report_file: copiedAuthority.file }, copiedAuthority), /identity changed/,
  'copying the current run id into a replacement inode must not recover report authority');

  const snapshotRepository = path.join(root, 'snapshot-repository');
  fs.mkdirSync(snapshotRepository);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: snapshotRepository }).status, 0);
  fs.writeFileSync(path.join(snapshotRepository, '.gitignore'), 'node_modules/\ndist/\n');
  fs.writeFileSync(path.join(snapshotRepository, 'package.json'), '{"type":"module"}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'entry.mjs'),
    "import tiny from 'tiny-dep';\nimport { workspace } from './packages/cli/worker.mjs';\nexport async function run() { return tiny + workspace + (await import('./lazy.mjs')).value; }\n");
  fs.writeFileSync(path.join(snapshotRepository, 'lazy.mjs'), "export const value = 'sealed';\n");
  fs.mkdirSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules', 'workspace-dep'),
    { recursive: true });
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'package.json'),
    '{"type":"module"}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'worker.mjs'),
    "import workspaceDep from 'workspace-dep';\nexport const workspace = workspaceDep;\n");
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    'workspace-dep', 'package.json'),
  '{"name":"workspace-dep","main":"index.js","optionalDependencies":{"workspace-platform":"1.0.0"}}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    'workspace-dep', 'index.js'), "module.exports = 'workspace sealed ';\n");
  fs.mkdirSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    'workspace-platform'));
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    'workspace-platform', 'package.json'),
  '{"name":"workspace-platform","main":"index.js"}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    'workspace-platform', 'index.js'), "module.exports = 'platform sealed';\n");
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', 'unrelated'), { recursive: true });
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'unrelated', 'huge.bin'),
    Buffer.alloc(1024 * 1024));
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', 'tiny-dep'));
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'tiny-dep', 'package.json'),
    '{"name":"tiny-dep","main":"index.js"}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'tiny-dep', 'index.js'),
    "module.exports = 'dependency sealed ';\n");
  fs.mkdirSync(path.join(snapshotRepository, 'dist'));
  const ignoredModel = path.join(snapshotRepository, 'dist', 'model.bin');
  fs.writeFileSync(ignoredModel, 'sealed model bytes');
  const snapshotOne = prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', path.join(snapshotRepository, 'entry.mjs'), ignoredModel],
    temporaryDirectory: path.join(root, 'snapshot-one'),
  });
  const snapshotTwo = prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', path.join(snapshotRepository, 'entry.mjs'), ignoredModel],
    temporaryDirectory: path.join(root, 'snapshot-two'),
  });
  assert.equal(snapshotOne.digest, snapshotTwo.digest,
    'execution snapshot digest must not depend on its random destination');
  assert.equal(fs.existsSync(path.join(snapshotOne.snapshot_repository,
    'node_modules', 'unrelated')), false, 'unrelated dependency trees must not be copied');
  assert.equal(fs.readFileSync(path.join(snapshotOne.snapshot_repository, 'packages', 'cli',
    'node_modules', 'workspace-dep', 'index.js'), 'utf8'),
  "module.exports = 'workspace sealed ';\n",
  'bare imports in a nested workspace must resolve from that workspace package');
  assert.equal(fs.readFileSync(path.join(snapshotOne.snapshot_repository, 'packages', 'cli',
    'node_modules', 'workspace-platform', 'index.js'), 'utf8'),
  "module.exports = 'platform sealed';\n",
  'installed platform optional dependencies must remain in the workspace-local closure');
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'tiny-dep', 'index.js'),
    "module.exports = 'replacement';\n");
  assert.match(fs.readFileSync(path.join(snapshotOne.snapshot_repository,
    'node_modules', 'tiny-dep', 'index.js'), 'utf8'), /dependency sealed/,
  'required package roots must be frozen while unrelated dependencies remain excluded');
  const ignoredModelAuthority = snapshotOne.entries.find((entry) =>
    entry.label === 'argv:dist/model.bin');
  assert.equal(fs.readFileSync(ignoredModelAuthority.path, 'utf8'), 'sealed model bytes',
    'ignored argv file inputs must be descriptor-copied into execution authority');
  fs.writeFileSync(path.join(snapshotRepository, 'lazy.mjs'), "export const value = 'replaced';\n");
  assert.match(fs.readFileSync(path.join(snapshotOne.snapshot_repository, 'lazy.mjs'), 'utf8'), /sealed/,
    'lazy local imports must use frozen bytes');
  assert.equal(assertExecutionSnapshot(snapshotOne), true);
  const fakeInfrastructure = path.join(snapshotRepository, '.git', 'fake-infrastructure');
  fs.mkdirSync(fakeInfrastructure, { recursive: true });
  const fakeNode = path.join(fakeInfrastructure, 'node');
  const fakeBwrap = path.join(fakeInfrastructure, 'bwrap');
  fs.writeFileSync(fakeNode, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  fs.writeFileSync(fakeBwrap, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const infrastructureSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository, command: ['/bin/sh', path.join(snapshotRepository, 'entry.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-infrastructure'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  });
  fs.writeFileSync(fakeBwrap, '#!/bin/sh\necho replacement\n', { mode: 0o700 });
  assert.equal(fs.readFileSync(infrastructureSnapshot.infrastructure.bwrap, 'utf8'),
    '#!/bin/sh\nexit 0\n', 'bwrap launch must use descriptor-copied authority, not its checked path');
  assert.equal(assertExecutionSnapshot(infrastructureSnapshot), true);
  const fakeNpx = path.join(fakeInfrastructure, 'npx');
  fs.writeFileSync(fakeNpx, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', 'agent-skills-eval'));
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'agent-skills-eval', 'package.json'),
    '{"name":"agent-skills-eval","bin":{"agent-skills-eval":"cli.mjs"},"dependencies":{"tiny-dep":"1.0.0"}}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'agent-skills-eval', 'cli.mjs'),
    "#!/usr/bin/env node\nimport tiny from 'tiny-dep'; console.log(tiny);\n", { mode: 0o700 });
  const npxSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository, command: [fakeNpx, '--yes', 'agent-skills-eval', '--version'],
    temporaryDirectory: path.join(root, 'snapshot-npx'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  });
  assert.equal(npxSnapshot.launch_command[0], npxSnapshot.infrastructure.node,
    'audited npx execution must launch through staged Node');
  assert.equal(npxSnapshot.launch_command[1], path.join(npxSnapshot.snapshot_repository,
    'node_modules', 'agent-skills-eval', 'cli.mjs'),
  'audited npx execution must launch the snapshotted declared package bin');
  assert.deepEqual(npxSnapshot.launch_command.slice(2), ['--version']);
  assert.notEqual(npxSnapshot.launch_command[0], fakeNpx,
    'the mutable npx shim must not remain on the launch path');
  fs.mkdirSync(path.join(snapshotRepository, 'tests'), { recursive: true });
  const envEntrypoint = path.join(snapshotRepository, 'tests', 'cli_binary_smoke_test.mjs');
  fs.writeFileSync(envEntrypoint, "import fs from 'node:fs';\n");
  const envOnlyModel = path.join(snapshotRepository, 'dist', 'env-only-model.bin');
  fs.writeFileSync(envOnlyModel, 'env-only sealed bytes');
  const environmentSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository, command: ['/bin/sh', envEntrypoint],
    temporaryDirectory: path.join(root, 'snapshot-environment'),
    environment: { LAMINA_MODEL: envOnlyModel },
  });
  const environmentAuthority = environmentSnapshot.entries.find((entry) =>
    entry.label === 'env:LAMINA_MODEL:dist/env-only-model.bin');
  fs.writeFileSync(envOnlyModel, 'replacement');
  assert.equal(fs.readFileSync(environmentAuthority.path, 'utf8'), 'env-only sealed bytes');
  fs.symlinkSync('/etc/passwd', path.join(snapshotRepository, 'escape.mjs'));
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository, command: ['/bin/sh', path.join(snapshotRepository, 'entry.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-escape'),
  }), /escapes the repository/);
  assert.equal(validateReport({ ...report, unexpected: true }).valid, false);
  assert.equal(validateReport({
    ...report,
    cleanup: { ...report.cleanup, scope_removed: 'yes' },
  }).valid, false);
  assert.equal(validateReport({ ...report, samples: [] }).valid, false);
  assert.equal(validateReport({
    ...report,
    outcome: 'safety_limit_exceeded',
    termination: { ...report.termination, reason: 'safety_limit_exceeded', limit: null },
  }).valid, false);
  for (const limit of ['enforcement_handshake', 'temporary_quota_handshake']) {
    const handshakeFailure = structuredClone(report);
    handshakeFailure.outcome = outcomeForStop('internal_error');
    handshakeFailure.samples = [];
    handshakeFailure.termination.reason = 'internal_error';
    handshakeFailure.termination.limit = limit;
    handshakeFailure.error = {
      code: limit === 'enforcement_handshake'
        ? 'LAMINA_SAFE_ENFORCEMENT_UNPROVEN'
        : 'LAMINA_SAFE_TEMP_QUOTA_UNPROVEN',
      message: 'proof unavailable before payload release',
    };
    const validation = validateReport(handshakeFailure);
    assert.equal(validation.valid, true, validation.errors.join('; '));
  }
  assert.equal(outcomeForStop('safety_limit_exceeded'), 'safety_limit_exceeded');
  assert.equal(outcomeForStop('interrupted'), 'interrupted');
  assert.ok(SYSTEMCTL_READBACK_TIMEOUT_MS < DEFAULTS.scopeHandshakeMs,
    'one transient readback must not consume the complete handshake window');
  assert.ok(SYSTEMCTL_CONTROL_TIMEOUT_MS >= DEFAULTS.scopeHandshakeMs,
    'destructive systemd control operations retain their complete timeout');
  const timedOutReadback = new Error('spawnSync systemctl ETIMEDOUT at /tmp/private');
  timedOutReadback.code = 'ETIMEDOUT';
  const timedOutState = cgroupResolutionState({
    status: null,
    signal: 'SIGTERM',
    error: timedOutReadback,
    stderr: 'Authorization: Bearer diagnostic-secret',
  });
  assert.deepEqual({
    ok: timedOutState.ok,
    status: timedOutState.status,
    signal: timedOutState.signal,
    error_code: timedOutState.error_code,
  }, { ok: false, status: null, signal: 'SIGTERM', error_code: 'ETIMEDOUT' });
  assert.match(timedOutState.error_message, /ETIMEDOUT/);
  assert.match(timedOutState.stderr, /diagnostic-secret/,
    'the adapter retains raw in-memory evidence for the report sanitizer');
  assert.equal(systemdAbsenceProof({
    status: 0,
    stdout: 'LoadState=not-found\nControlGroup=\n',
  }, false), true);
  assert.equal(systemdAbsenceProof({
    status: 0,
    stdout: 'LoadState=loaded\nControlGroup=/user.slice/unit.scope\n',
  }, false), false);
  assert.equal(systemdAbsenceProof({
    status: 0,
    stdout: 'LoadState=not-found\nControlGroup=\n',
  }, true), false, 'a cached cgroup that still exists must prevent idempotent success');
  assert.equal(systemdAbsenceProof({
    status: null,
    error: new Error('D-Bus unavailable'),
    stdout: '',
  }, false), false, 'an unproven systemd lookup must fail closed');
  const unavailableAdapter = Object.assign(Object.create(LinuxSystemdAdapter.prototype), {
    limits: eightGib,
    resolveCgroup: () => null,
  });
  assert.deepEqual(unavailableAdapter.enforcementProof(), {
    ok: false,
    reason: 'cgroup path is unavailable',
    actual: null,
    expected: {
      memory_max_bytes: eightGib.memory_max_bytes,
      memory_high_bytes: eightGib.memory_high_bytes,
      pids_max: eightGib.pids_max,
    },
  });
  const diagnostic = boundedDiagnosticText(
    `Authorization: Bearer diagnostic-secret failed at /tmp/private/scope.ready ${'x'.repeat(1_200)}`,
  );
  assert.doesNotMatch(diagnostic, /diagnostic-secret|\/tmp\/private/);
  assert.match(diagnostic, /\[REDACTED\]|\[REDACTED_PATH\]/);
  assert.ok(diagnostic.length <= 1_000);
  const summarizedError = boundedCaseError({
    code: `LAMINA_${'X'.repeat(200)}`,
    message: 'Authorization: Bearer secret-token',
  });
  assert.equal(summarizedError.code.length, 128);
  assert.doesNotMatch(JSON.stringify(summarizedError), /secret-token/);
  assert.equal(boundedCaseError({ code: 'TEST', message: 'y'.repeat(600) }).message.length, 500);
  const unwritableParent = path.join(root, 'not-a-directory');
  fs.writeFileSync(unwritableParent, 'file');
  const fallbackReport = structuredClone(report);
  const fallback = writeReportWithFallback(path.join(unwritableParent, 'report.json'), fallbackReport);
  assert.equal(fallback.fallback, true);
  assert.equal(validateReport(JSON.parse(fs.readFileSync(fallback.path))).valid, true);
  fs.rmSync(fallback.path, { force: true });

  const priorBroker = process.env.LAMINA_SAFE_RUNNER_BROKER;
  const priorContext = process.env.LAMINA_SAFE_RUNNER_CONTEXT;
  const priorToken = process.env.LAMINA_SAFE_RUNNER_TOKEN;
  process.env.LAMINA_SAFE_RUNNER_CONTEXT = JSON.stringify({
    schema: 'lamina.safe-runner-context/v1', tier: 'large', adapter: 'linux-systemd-cgroup-v2',
  });
  process.env.LAMINA_SAFE_RUNNER_TOKEN = 'caller-forged';
  process.env.LAMINA_SAFE_RUNNER_BROKER = path.join(root, 'caller-forged.sock');
  assert.equal(safeRunnerContext(), null, 'caller-authored environment must never authorize work');
  if (priorBroker === undefined) delete process.env.LAMINA_SAFE_RUNNER_BROKER;
  else process.env.LAMINA_SAFE_RUNNER_BROKER = priorBroker;
  if (priorContext === undefined) delete process.env.LAMINA_SAFE_RUNNER_CONTEXT;
  else process.env.LAMINA_SAFE_RUNNER_CONTEXT = priorContext;
  if (priorToken === undefined) delete process.env.LAMINA_SAFE_RUNNER_TOKEN;
  else process.env.LAMINA_SAFE_RUNNER_TOKEN = priorToken;

  const requester = { pid: 41000, ppid: 1, start_ticks: '99', command: 'node guarded.mjs' };
  const authorityRecords = [requester];
  const brokerRegistrations = [];
  const brokerReservations = [];
  const authority = {
    runId: 'unit', tier: 'small', adapter: 'linux-systemd-cgroup-v2',
    unit: 'lamina-safe-unit.scope', cgroup: '/unit',
    enforcement: { memory_max_bytes: 1, memory_high_bytes: 1, pids_max: 1 },
    registrations: brokerRegistrations,
    reservations: brokerReservations,
    records: () => authorityRecords,
    reserve: (record) => { brokerReservations.push(record); return record; },
    bind: (record) => {
      brokerRegistrations.push(record);
      const reserved = brokerReservations.find((item) => item.token === record.reservation);
      if (reserved) reserved.bound = {
        pid: record.pid, namespace_pid: record.namespace_pid, start_ticks: record.start_ticks,
      };
      return true;
    },
    release: (record) => {
      const reserved = brokerReservations.find((item) => item.token === record.reservation);
      if (reserved) reserved.released = true;
      return Boolean(reserved);
    },
    lockReady: () => true,
    seal: () => [{ state: 'sealed' }],
  };
  assert.equal(authorizeBrokerRequest({
    operation: 'context', requester, minimum_tier: 'small',
  }, authority).ok, true);
  assert.equal(authorizeBrokerRequest({
    operation: 'context', requester, minimum_tier: 'medium',
  }, authority).ok, false, 'a child cannot escalate its tier');
  assert.equal(authorizeBrokerRequest({
    operation: 'context', requester: { ...requester, start_ticks: 'tampered' }, minimum_tier: 'small',
  }, authority).ok, false, 'PID identity tampering must fail');
  assert.equal(authorizeBrokerRequest({
    operation: 'context', requester, minimum_tier: 'small',
  }, { ...authority, unit: '' }).ok, false, 'an empty unit must fail closed');
  const brokerDirectory = path.join(root, 'broker-close');
  fs.mkdirSync(brokerDirectory);
  const liveBroker = await createProofBroker(brokerDirectory, authority);
  const halfOpenClient = net.createConnection(liveBroker.socketPath);
  await once(halfOpenClient, 'connect');
  const brokerCloseStarted = Date.now();
  await liveBroker.close();
  assert.ok(Date.now() - brokerCloseStarted < 1_000,
    'broker cleanup must be bounded when a requester dies before sending a complete request');

  const limitedBrokerDirectory = path.join(root, 'broker-limits');
  fs.mkdirSync(limitedBrokerDirectory);
  const limitedBroker = await createProofBroker(limitedBrokerDirectory, authority, {
    maxConnections: 1, idleTimeoutMs: 75, maxRequestsPerWindow: 1, requestWindowMs: 1_000,
  });
  const saturated = net.createConnection(limitedBroker.socketPath);
  await once(saturated, 'connect');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const refusedAtCap = net.createConnection(limitedBroker.socketPath);
  refusedAtCap.on('error', () => {});
  await Promise.race([
    once(refusedAtCap, 'close'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('broker cap did not close')), 500)),
  ]);
  await Promise.race([
    once(saturated, 'close'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('idle broker request did not expire')), 500)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const brokerRpc = (broker, frames) => new Promise((resolve, reject) => {
    const socket = net.createConnection(broker.socketPath);
    let response = '';
    const deadline = setTimeout(() => { socket.destroy(); reject(new Error('broker rpc timeout')); }, 500);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(frames));
    socket.on('data', (chunk) => { response += chunk; });
    socket.once('error', reject);
    socket.once('close', () => {
      clearTimeout(deadline);
      try { resolve(JSON.parse(response.trim())); } catch (error) { reject(error); }
    });
  });
  const contextFrame = `${JSON.stringify({
    operation: 'context', requester, minimum_tier: 'small',
  })}\n`;
  assert.equal((await brokerRpc(limitedBroker, contextFrame)).ok, true,
    'a valid request must succeed after the saturated idle connection expires');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match((await brokerRpc(limitedBroker, contextFrame)).error, /rate exceeded/,
    'sequential reconnects must remain under a bounded aggregate request rate');
  await limitedBroker.close();

  const oneRequestDirectory = path.join(root, 'broker-one-request');
  fs.mkdirSync(oneRequestDirectory);
  const oneRequestBroker = await createProofBroker(oneRequestDirectory, authority);
  const pipelined = await brokerRpc(oneRequestBroker, `${contextFrame}${contextFrame}`);
  assert.equal(pipelined.ok, false);
  assert.match(pipelined.error, /exactly one request/);
  await oneRequestBroker.close();

  const authorizedGraphd = {
    pid: 41001, ppid: requester.pid, start_ticks: '100',
    command: `${process.execPath} /repo/packages/cli/lib/graph-runtime/server.mjs /repo`,
  };
  for (const command of [
    `${process.execPath} /repo/packages/cli/lib/graph-runtime/server.mjs /repo`,
    `${process.execPath} /tmp/lamina/runtime/app/lib/graph-runtime/server.mjs /repo`,
    '/usr/local/bin/lamina-linux-x64 --graphd /repo',
    '/opt/lamina/runtime/cocoindex-worker retrieval serve',
    '/tmp/lamina-cocoindex-worker-linux-x64 observe',
    `${process.execPath} /repo/packages/cli/retrieval_worker.py serve`,
  ]) assert.equal(isLaminaProcessCommand(command), true, command);
  for (const command of [
    `${process.execPath} tests/tiny.mjs`,
    'gh run view 123 --repo aryaniyaps/lamina',
    `${process.execPath} tests/tiny.mjs /repo/lamina`,
    'tool --graphd /repo',
    'sh -c /usr/local/bin/lamina',
  ]) assert.equal(isLaminaProcessCommand(command), false, command);
  assert.throws(
    () => assertSystemctlSuccess({ status: 1, stderr: 'access denied' }, 'systemctl stop unit'),
    /systemctl stop unit failed: access denied/,
  );
  assert.equal(parseSystemdMajor('systemd 249 (249.11-0ubuntu3.17)'), 249);
  assert.equal(parseSystemdMajor('systemd 259 (259.5-0ubuntu3)'), 259);
  assert.deepEqual(systemdKillArguments('SIGKILL', 'lamina-safe-unit.scope', 249), [
    'kill', '--kill-who=all', '--signal=SIGKILL', 'lamina-safe-unit.scope',
  ]);
  assert.deepEqual(systemdKillArguments('SIGTERM', 'lamina-safe-unit.scope', 252), [
    'kill', '--kill-whom=all', '--signal=SIGTERM', 'lamina-safe-unit.scope',
  ]);
  assert.throws(() => parseSystemdMajor('not systemd'), /unsupported or unparsable/);
  assert.throws(() => systemdKillArguments('SIGTERM', 'unit.scope', 248), /unsupported/);
  const scopeProperties = systemdScopeProperties({
    memory_max_bytes: 100,
    memory_high_bytes: 80,
    pids_max: 8,
    timeout_ms: 1_000,
    graceful_stop_ms: 100,
  }).join(' ');
  for (const required of [
    'MemoryAccounting=yes', 'MemoryMax=100', 'MemoryHigh=80',
    'TasksAccounting=yes', 'TasksMax=8', 'KillMode=control-group',
    'SendSIGKILL=yes', 'RuntimeMaxSec=7s',
  ]) assert.match(scopeProperties, new RegExp(required));
  assert.doesNotMatch(scopeProperties, /OOMPolicy/);
  assert.equal(await stopIncompatibleServer({
    root,
    lock: path.join(root, 'missing-graphd.lock'),
    token: path.join(root, 'missing-graphd.token'),
  }), undefined, 'stopping an absent graphd must complete without a stray response reference');
  if (process.platform === 'linux') {
    const sourceGraphd = spawn(process.execPath, [
      '-e', 'setInterval(() => {}, 1_000)', '/repo/packages/cli/lib/graph-runtime/server.mjs',
    ], { stdio: 'ignore' });
    try {
      let found = [];
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        found = existingLaminaProcesses();
        if (found.some((record) => record.pid === sourceGraphd.pid)) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(found.some((record) => record.pid === sourceGraphd.pid),
        'a pre-existing source graphd must be detected outside a new scope');
      const refused = preflightRun({
        tier: 'small', command: [process.execPath, 'tests/tiny.mjs'], cwd: root,
        adapterInfo: portableProbe, injectedExistingProcesses: found,
      });
      assert.equal(refused.ok, false);
      assert.match(refused.reasons.join('\n'), new RegExp(`existing Lamina processes.*${sourceGraphd.pid}`));
    } finally {
      sourceGraphd.kill('SIGTERM');
      if (sourceGraphd.exitCode === null) await once(sourceGraphd, 'exit');
    }
  }

  const managedRegistrations = [{
    pid: 41001,
    start_ticks: '100',
    role: 'graphd',
    socket: '/repo/.git/lamina/graphd.sock',
    lock: '/repo/.git/lamina/graphd.lock',
  }];
  const graphdRecord = { ...authorizedGraphd, ppid: 1 };
  const graphdWorker = {
    pid: 41002, ppid: graphdRecord.pid, start_ticks: '101', command: 'retrieval_worker.py',
  };
  assert.deepEqual(registeredManagedGraphd(managedRegistrations, [graphdRecord]), [{
    ...graphdRecord,
    managed_socket: managedRegistrations[0].socket,
    managed_lock: managedRegistrations[0].lock,
  }]);
  authorityRecords.push(graphdRecord);
  const reservation = authorizeBrokerRequest({
    operation: 'reserve_graphd', requester,
    socket: managedRegistrations[0].socket,
    lock: managedRegistrations[0].lock,
  }, authority);
  assert.equal(reservation.ok, true);
  assert.equal(authorizeBrokerRequest({
    operation: 'bind_graphd', reservation: reservation.reservation,
    requester,
    child: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
  }, authority).ok, true);
  assert.equal(brokerRegistrations.length, 1);
  assert.equal(authorizeBrokerRequest({
    operation: 'start_graphd', reservation: reservation.reservation,
    requester: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
  }, authority).ok, true);
  assert.equal(authorizeBrokerRequest({
    operation: 'graphd_lock_ready', reservation: reservation.reservation,
    requester: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
  }, authority).ok, true);
  assert.equal(authorizeBrokerRequest({
    operation: 'seal_graphd', reservation: reservation.reservation, requester,
  }, authority).ok, true);
  assert.equal(authorizeBrokerRequest({
    operation: 'bind_graphd', requester, reservation: reservation.reservation,
    child: { pid: graphdRecord.pid, start_ticks: 'forged' },
  }, authority).ok, false, 'payload cannot self-assert a graphd identity');
  assert.equal(authorizeBrokerRequest({
    operation: 'reserve_graphd',
    requester,
    socket: 'relative.sock',
    lock: 'relative.lock',
  }, authority).ok, false);
  assert.equal(
    classifyRemainingDescendants(managedRegistrations, [graphdRecord, graphdWorker]).kind,
    'managed_graphd',
  );
  assert.equal(classifyRemainingDescendants([], [{
    pid: 77, start_ticks: 'new', state: 'S', command: 'reused-pid',
  }], [{ pid: 77, start_ticks: 'old' }]).kind, 'unmanaged',
  'a reused infrastructure PID must not be ignored without its exact start identity');
  assert.equal(
    classifyRemainingDescendants(managedRegistrations, [graphdRecord, {
      pid: 41004, ppid: 1, start_ticks: '103', state: 'Z', command: '',
    }]).kind,
    'managed_graphd',
  );
  assert.equal(
    classifyRemainingDescendants(managedRegistrations, [graphdRecord, graphdWorker, {
      pid: 41003, ppid: 1, start_ticks: '102', command: 'unregistered-daemon',
    }]).kind,
    'unmanaged',
  );
  assert.deepEqual(registeredManagedGraphd([
    { pid: 41001, start_ticks: 'wrong', role: 'graphd' },
  ], [graphdRecord]), []);

  const managedRoot = path.join(root, 'managed-objects');
  fs.mkdirSync(managedRoot);
  const managedSocket = path.join(managedRoot, 'graphd.sock');
  const managedLock = path.join(managedRoot, 'graphd.lock');
  const reservationToken = 'a'.repeat(64);
  const reservedObjects = reserveManagedObjects(managedSocket, managedLock, reservationToken);
  assert.equal(reservedObjects.every((item) => item.state === 'reserved'), true);
  const boundObjects = bindManagedObjects(reservedObjects, [process.pid, 2]);
  assert.equal(boundObjects.every((item) => item.state === 'bound'), true);
  assert.deepEqual(removeManagedObjects(boundObjects), [], 'absent bound objects are already clean');
  const authorizedObjects = authorizeManagedObjects(boundObjects);
  assert.equal(authorizedObjects.every((item) => item.state === 'authorized'), true);
  const lockOnlyRoot = path.join(root, 'managed-lock-only');
  fs.mkdirSync(lockOnlyRoot);
  const lockOnlySocket = path.join(lockOnlyRoot, 'graphd.sock');
  const lockOnlyLock = path.join(lockOnlyRoot, 'graphd.lock');
  const lockOnlyReserved = reserveManagedObjects(lockOnlySocket, lockOnlyLock, reservationToken);
  const lockOnlyAuthorized = authorizeManagedObjects(
    bindManagedObjects(lockOnlyReserved, [process.pid]),
  );
  fs.writeFileSync(lockOnlyLock, `${JSON.stringify({
    pid: process.pid, safe_runner_reservation: reservationToken,
  })}\n`);
  assert.deepEqual(removeManagedObjects(lockOnlyAuthorized), [],
    'an authorized exact lock may be cleaned before its socket is created');
  const replacementReserved = reserveManagedObjects(lockOnlySocket, lockOnlyLock, reservationToken);
  const replacementAuthorized = authorizeManagedObjects(
    bindManagedObjects(replacementReserved, [process.pid]),
  );
  fs.writeFileSync(lockOnlyLock, `${JSON.stringify({
    pid: process.pid, safe_runner_reservation: 'b'.repeat(64),
  })}\n`);
  assert.deepEqual(removeManagedObjects(replacementAuthorized), [lockOnlyLock],
    'a wrong-token reservation replacement must survive cleanup');
  fs.unlinkSync(lockOnlyLock);
  fs.writeFileSync(managedLock, `${JSON.stringify({
    pid: process.pid, safe_runner_reservation: reservationToken,
  })}\n`);
  const managedServer = net.createServer(() => {});
  await new Promise((resolve, reject) => managedServer.listen(managedSocket, resolve).once('error', reject));
  const sealedObjects = sealManagedObjects(authorizedObjects);
  assert.equal(sealedObjects.every((item) => item.state === 'sealed'), true);
  const lockRecord = sealedObjects.find((item) => item.type === 'lock');
  const originalLock = `${managedLock}.original`;
  const refusedToctou = removeManagedObjects(sealedObjects, {
    beforeUnlink(record) {
      if (record.type !== 'lock') return;
      fs.renameSync(managedLock, originalLock);
      fs.writeFileSync(managedLock, 'foreign same-uid replacement\n');
    },
  });
  assert.deepEqual(refusedToctou, [managedLock]);
  assert.equal(fs.readFileSync(managedLock, 'utf8'), 'foreign same-uid replacement\n');
  assert.equal(lstatPresence(managedSocket).exists, false);
  fs.rmSync(managedLock);
  fs.rmSync(originalLock);
  await new Promise((resolve) => managedServer.close(resolve));
  fs.symlinkSync(path.join(managedRoot, 'absent-target'), managedSocket);
  assert.equal(lstatPresence(managedSocket).exists, true, 'dangling symlink is present by lstat');
  assert.equal(reserveManagedObjects(managedSocket, managedLock, reservationToken), null);
  fs.unlinkSync(managedSocket);
  fs.symlinkSync(path.join(managedRoot, 'absent-lock-target'), managedLock);
  assert.equal(lstatPresence(managedLock).exists, true, 'dangling lock symlink is present by lstat');
  assert.equal(reserveManagedObjects(managedSocket, managedLock, reservationToken), null);
  fs.unlinkSync(managedLock);
  const unsealedObjects = bindManagedObjects(
    reserveManagedObjects(managedSocket, managedLock, reservationToken), [process.pid, 2],
  );
  fs.writeFileSync(managedLock, `${JSON.stringify({
    pid: process.pid, safe_runner_reservation: 'b'.repeat(64),
  })}\n`);
  const foreignServer = net.createServer(() => {});
  await new Promise((resolve, reject) => foreignServer.listen(managedSocket, resolve).once('error', reject));
  assert.deepEqual(removeManagedObjects(unsealedObjects), [managedSocket, managedLock],
    'unsealed objects without the reservation-bound lock proof must remain incomplete');
  fs.unlinkSync(managedSocket);
  fs.unlinkSync(managedLock);
  await new Promise((resolve) => foreignServer.close(resolve));
  assert.ok(reserveManagedObjects(managedSocket, managedLock, reservationToken),
    'a subsequent run can reserve after exact path recovery');
  assert.equal(lockRecord.object_identity.lock_pid, process.pid);

  if (process.platform === 'linux') {
    const claims = path.join(root, 'production-locks');
    fs.mkdirSync(claims, { recursive: true, mode: 0o755 });
    assert.throws(() => acquireConcurrencyLock({ directory: claims }),
      /physical same-user mode-0700/);
    fs.chmodSync(claims, 0o700);
    fs.writeFileSync(path.join(claims, 'stale.json'), JSON.stringify({
      pid: process.pid, start_ticks: 'stale', nonce: 'never-reused',
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-stale.scope', cgroup: null },
    }));
    const lock = acquireConcurrencyLock({ directory: claims, proveScopeAbsent: () => true,
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-current.scope', cgroup: null } });
    assert.throws(() => acquireConcurrencyLock({ directory: claims }), /another medium\/large safe-runner/);
    assert.equal(lock.release(), true);
    assert.deepEqual(fs.readdirSync(claims), []);
    const replacementLock = acquireConcurrencyLock({
      directory: claims,
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-replacement.scope', cgroup: null },
      proveScopeAbsent: () => true,
    });
    const copiedClaim = fs.readFileSync(replacementLock.file, 'utf8');
    const originalClaim = `${replacementLock.file}.original`;
    fs.renameSync(replacementLock.file, originalClaim);
    fs.writeFileSync(replacementLock.file, copiedClaim, { mode: 0o600 });
    assert.throws(() => replacementLock.release(), /file identity changed/);
    assert.equal(fs.existsSync(replacementLock.file), true,
      'same-content replacement claim must not be unlinked');
    fs.rmSync(replacementLock.file);
    fs.rmSync(originalClaim);
    const staleRace = path.join(claims, 'stale-race.json');
    const staleRaceValue = JSON.stringify({
      pid: process.pid, start_ticks: 'stale-race', nonce: 'copied-nonce',
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-stale-race.scope', cgroup: null },
    });
    fs.writeFileSync(staleRace, staleRaceValue);
    assert.throws(() => acquireConcurrencyLock({
      directory: claims,
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-new-race.scope', cgroup: null },
      proveScopeAbsent() {
        fs.renameSync(staleRace, `${staleRace}.original`);
        fs.writeFileSync(staleRace, staleRaceValue);
        return true;
      },
    }), /identity changed during absence proof/);
    assert.equal(fs.existsSync(staleRace), true);
    fs.rmSync(staleRace);
    fs.rmSync(`${staleRace}.original`);
  }
  const globalLock = productionLockDirectory();
  process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'different-state');
  assert.equal(productionLockDirectory(), globalLock, 'state override must not split the host-global lock');

  assert.throws(() => recordPromotion(root, 'small', { outcome: 'success' }), /verified cleanup/);
  assert.throws(() => recordPromotion(root, 'small', report), /--workload/);
  const auditedEvidence = {
    ...report,
    command: [process.execPath, path.resolve('tests/fixtures/safe-runner-adversary.mjs'), 'success'],
  };
  recordPromotion(root, 'small', auditedEvidence, 'unit-workload', auditedEvidence.command);
  assert.equal(checkPromotion(root, 'medium', 'unit-workload', auditedEvidence.command).ok, true);
  assert.equal(checkPromotion(root, 'medium', 'unit-workload', [
    ...auditedEvidence.command, '--different-workload-semantics',
  ]).ok, false, 'promotion must bind the complete normalized argv');
  const unrelatedCommand = ['node', path.join(root, 'unrelated.mjs')];
  fs.writeFileSync(unrelatedCommand[1], 'export {};\n');
  assert.equal(checkPromotion(root, 'medium', 'unit-workload', [
    process.execPath, path.resolve('tests/fixtures/safe-runner-graphd-client.mjs'),
  ]).ok, false);
  assert.throws(
    () => promotionCommandDigest(root, unrelatedCommand),
    (error) => error.code === 'LAMINA_SAFE_SOURCE_IDENTITY',
  );
  const sourceRepository = path.join(root, 'source-identity-repository');
  fs.mkdirSync(sourceRepository);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: sourceRepository }).status, 0);
  const sourceEntrypoint = path.join(sourceRepository, 'entry.mjs');
  const importedSource = path.join(sourceRepository, 'imported.mjs');
  fs.writeFileSync(sourceEntrypoint, 'import "./imported.mjs";\n');
  fs.writeFileSync(importedSource, 'export const value = 1;\n');
  assert.equal(spawnSync('git', ['add', '.'], { cwd: sourceRepository }).status, 0);
  assert.equal(spawnSync('git', [
    '-c', 'user.name=Safe Runner Test', '-c', 'user.email=safe-runner@example.invalid',
    'commit', '--quiet', '-m', 'fixture',
  ], { cwd: sourceRepository }).status, 0);
  const sourceBefore = repositorySourceDigest(sourceRepository);
  const frozenA = frozenWorkloadIdentity(sourceRepository, [process.execPath, 'entry.mjs']);
  assert.equal(frozenA.executable.path, fs.realpathSync.native(process.execPath));
  assert.match(frozenA.executable.digest, /^[a-f0-9]{64}$/);
  assert.ok(Number(frozenA.executable.size) > 0);
  const promotionBefore = promotionCommandDigest(sourceRepository, [process.execPath, sourceEntrypoint]);
  fs.writeFileSync(importedSource, 'export const value = 2;\n');
  assert.notEqual(repositorySourceDigest(sourceRepository), sourceBefore);
  assert.notEqual(
    promotionCommandDigest(sourceRepository, [process.execPath, sourceEntrypoint]),
    promotionBefore,
    'an imported source change must invalidate workload promotion identity',
  );
  const mutationEvidence = { ...structuredClone(report), command: [process.execPath, 'entry.mjs'] };
  recordPromotion(sourceRepository, 'small', mutationEvidence, 'self-mutation',
    mutationEvidence.command, frozenA);
  assert.equal(checkPromotion(sourceRepository, 'medium', 'self-mutation',
    mutationEvidence.command).ok, false,
  'payload mutation must not promote the post-release source as tested evidence');
  const frozenB = frozenWorkloadIdentity(sourceRepository, mutationEvidence.command);
  const activeAttempt = beginSafetyAttempt(sourceRepository, frozenB, mutationEvidence);
  assert.equal(checkSafetyRetry(sourceRepository, mutationEvidence.command, report.limits).ok, false,
    'a controller-crash-capable active attempt must durably fence unchanged work');
  assert.equal(clearSafetyAttempt(sourceRepository, activeAttempt), true);
  assert.equal(checkSafetyRetry(sourceRepository, mutationEvidence.command, report.limits).ok, true);
  const sourceRetryCommand = [process.execPath, sourceEntrypoint];
  const sourceRetryReport = structuredClone(report);
  sourceRetryReport.command = sourceRetryCommand;
  sourceRetryReport.termination.limit = 'timeout';
  recordSafetyLimit(sourceRepository, sourceRetryCommand, report.limits, sourceRetryReport);
  assert.equal(checkSafetyRetry(sourceRepository, sourceRetryCommand, {
    ...report.limits, timeout_ms: report.limits.timeout_ms - 10,
  }).ok, false);
  fs.writeFileSync(importedSource, 'export const value = 3;\n');
  assert.equal(checkSafetyRetry(sourceRepository, sourceRetryCommand, report.limits).ok, true,
    'changing imported source must establish a new retry identity');
  fs.writeFileSync(path.join(sourceRepository, 'oversized-untracked.bin'), '1234');
  assert.throws(
    () => repositorySourceDigest(sourceRepository, { maxUntrackedBytes: 3 }),
    (error) => error.code === 'LAMINA_SAFE_SOURCE_IDENTITY',
  );
  fs.rmSync(path.join(sourceRepository, 'oversized-untracked.bin'));
  assert.equal(checkPromotion(root, 'medium', 'unrelated-workload', auditedEvidence.command).ok, false);
  const limitedReport = structuredClone(report);
  limitedReport.termination.limit = 'timeout';
  limitedReport.command = auditedEvidence.command;
  recordSafetyLimit(root, limitedReport.command, report.limits, limitedReport);
  assert.equal(checkSafetyRetry(root, limitedReport.command, report.limits).ok, false);
  assert.equal(checkSafetyRetry(root, [...limitedReport.command, '--changed'], report.limits).ok, true);
  assert.equal(checkSafetyRetry(root, limitedReport.command, {
    ...report.limits, timeout_ms: report.limits.timeout_ms - 1,
  }).ok, false, 'limit-only changes must not bypass the retry fence');
  const otherLimitedReport = structuredClone(limitedReport);
  otherLimitedReport.command = [...limitedReport.command, '--other'];
  recordSafetyLimit(root, otherLimitedReport.command, report.limits, otherLimitedReport);
  assert.equal(checkSafetyRetry(root, limitedReport.command, report.limits).ok, false,
    'recording a different failure must retain the original fence');

  const productionProbe = { ...portableProbe, id: 'unit-production', production_enforcement: true };
  writeAttestation(productionProbe, Array.from({ length: 11 }, (_, index) => ({
    id: `wrong-${index}`,
    passed: true,
    cleanup_verified: true,
    outcome: 'success',
    report_digest: 'a'.repeat(64),
  })));
  assert.equal(readAttestation(productionProbe).valid, false);
  const validCases = SELF_TEST_CASE_IDS.map((id) => ({
    id,
    passed: true,
    cleanup_verified: true,
    outcome: 'success',
    report_digest: 'b'.repeat(64),
  }));
  writeAttestation(productionProbe, validCases);
  assert.equal(readAttestation(productionProbe).valid, true);
  const promotionRoot = path.join(root, 'unpromoted-repository');
  fs.mkdirSync(promotionRoot);
  const unpromoted = preflightRun({
    tier: 'medium', command: auditedEvidence.command, cwd: promotionRoot,
    adapterInfo: productionProbe, injectedExistingProcesses: [],
  });
  assert.equal(unpromoted.ok, false);
  assert.match(unpromoted.reasons.join('\n'), /tier promotion requires successful cleanup for: small/);

  assertAdapterShape({
    id: 'unit', launch() {}, sample() {}, signal() {}, cleanup() {},
  });
  assert.throws(() => assertAdapterShape({ id: 'broken' }), /launch/);

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(packageJson.scripts['safe:run'], /safe-runner\/cli\.mjs run/);
  assert.match(packageJson.scripts['safe:self-test'], /safe-runner\/cli\.mjs self-test/);
  assert.match(packageJson.scripts['test:safe-runner'], /safe_runner_integration_test/);
  const readme = fs.readFileSync('README.md', 'utf8');
  const guide = fs.readFileSync('docs/content/advanced/safe-runner.mdx', 'utf8');
  const adr = fs.readFileSync('docs/decisions/014-crash-safe-resource-supervision.md', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/safe-runner.yml', 'utf8');
  const publishWorkflow = fs.readFileSync('.github/workflows/publish-cli.yml', 'utf8');
  assert.match(readme, /npm run safe:envelope/);
  assert.match(guide, /--tier small[\s\S]*--report[\s\S]*--promote/);
  assert.match(guide, /There is no unrestricted fallback/);
  assert.match(adr, /# ADR-014:[\s\S]*## Decision[\s\S]*systemd scope/);
  assert.match(workflow, /ubuntu-22\.04[\s\S]*bubblewrap_0\.8\.0-2\+deb12u1_amd64\.deb[\s\S]*3cc9134a3286ad01a323dcd924ba123eb634cefaeec82d774257e06308aeaadb[\s\S]*npm run safe:self-test/);
  assert.doesNotMatch(workflow, /\bsudo\b/);
  assert.match(publishWorkflow, /LAMINA_SAFE_RUNNER_STATE_DIR: \$\{\{ runner\.temp \}\}\/lamina-safe-runner-state/);
  assert.doesNotMatch(publishWorkflow, /LAMINA_SAFE_RUNNER_STATE_DIR:\s+\.lamina-safe-runner/);

  process.stdout.write('safe-runner unit contracts passed\n');
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
}
