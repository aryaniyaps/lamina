#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { adapterProbe, assertAdapterShape, boundedProbeFailure } from '../scripts/safe-runner/adapter.mjs';
import {
  authorizeBrokerRequest, createProofBroker, exactGraphdLaunchAuthorized,
} from '../scripts/safe-runner/broker.mjs';
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
import {
  existingLaminaProcesses, isLaminaProcessCommand, MAX_PROCESS_ENVIRONMENT_BYTES,
  processEnvironmentAttestation,
} from '../scripts/safe-runner/processes.mjs';
import {
  assertExecutionSnapshot, assertGitObjectClosureBudget, auditedNpxPackage, packageName,
  prepareExecutionSnapshot,
} from '../scripts/safe-runner/execution-snapshot.mjs';
import { redactCommand, redactEvidence, redactText } from '../scripts/safe-runner/redaction.mjs';
import {
  graphdEnvironment, stopIncompatibleServer,
} from '../packages/cli/lib/graph-runtime/client.mjs';
import { runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
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
  bindExecutionSnapshotIdentity,
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
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ]) assert.equal(isExecutionHookEnvironment(name), true, name);
  const poison = sanitizedEnvironment({
    SAFE_VALUE: 'kept', LD_DEBUG_OUTPUT: '/tmp/ld', NODE_V8_COVERAGE: '/tmp/v8',
    NODE_COMPILE_CACHE: '/tmp/cache', NODE_REDIRECT_WARNINGS: '/tmp/warnings',
    GIT_DIR: '/tmp/live-git', GIT_CONFIG_NOSYSTEM: '0', GIT_CONFIG_GLOBAL: '/tmp/config',
    'BASH_FUNC_payload%%': '() { touch /tmp/pwned; }',
  });
  assert.equal(poison.SAFE_VALUE, 'kept');
  for (const name of [
    'LD_DEBUG_OUTPUT', 'NODE_V8_COVERAGE', 'NODE_COMPILE_CACHE',
    'NODE_REDIRECT_WARNINGS', 'BASH_FUNC_payload%%',
  ]) assert.equal(poison[name], undefined, name);
  assert.equal(poison.GIT_DIR, undefined);
  assert.equal(poison.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(poison.GIT_CONFIG_GLOBAL, process.platform === 'win32' ? 'NUL' : '/dev/null');
  assert.equal(sanitizedEnvironment(poison).GIT_CONFIG_NOSYSTEM, '1',
    'repeated sanitizer layers must restore safe Git config overrides');
  const previousGraphdNodeOptions = process.env.NODE_OPTIONS;
  const previousGraphdSafeValue = process.env.LAMINA_GRAPH_ENV_TEST;
  process.env.NODE_OPTIONS = '--require=/tmp/hostile-graphd-loader.cjs';
  process.env.LAMINA_GRAPH_ENV_TEST = 'kept';
  try {
    const graphdEnv = graphdEnvironment();
    assert.equal(graphdEnv.NODE_OPTIONS, undefined);
    assert.equal(graphdEnv.LAMINA_GRAPH_ENV_TEST, 'kept');
  } finally {
    if (previousGraphdNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousGraphdNodeOptions;
    if (previousGraphdSafeValue === undefined) delete process.env.LAMINA_GRAPH_ENV_TEST;
    else process.env.LAMINA_GRAPH_ENV_TEST = previousGraphdSafeValue;
  }
  const cleanProcessEnvironment = processEnvironmentAttestation(
    Buffer.from('PATH=/usr/bin\0LAMINA_SAFE_RUNNER=1\0'),
  );
  assert.deepEqual(cleanProcessEnvironment.execution_hooks, []);
  assert.deepEqual(processEnvironmentAttestation(
    Buffer.from('PATH=/usr/bin\0NODE_OPTIONS=--require=/tmp/loader.cjs\0'),
  ).execution_hooks, ['NODE_OPTIONS']);
  assert.deepEqual(processEnvironmentAttestation(
    Buffer.from('NODE_PATH=/tmp/modules\0NODE_LOADER=/tmp/loader.mjs\0'),
  ).execution_hooks, ['NODE_LOADER', 'NODE_PATH']);
  assert.equal(processEnvironmentAttestation(Buffer.from('PATH=/usr/bin')).malformed, true,
    'a non-terminated proc environment must fail closed as malformed');
  assert.equal(processEnvironmentAttestation(Buffer.alloc(
    MAX_PROCESS_ENVIRONMENT_BYTES + 1,
  )).bounded, false, 'an oversized proc environment must fail closed');

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
  const indirectUnsealedEvalRuntime = preflightRun({
    tier: 'small', cwd: process.cwd(), adapterInfo: portableProbe,
    command: [process.execPath, path.resolve('evals/scripts/run-reference-matrix.mjs')],
  });
  assert.match(indirectUnsealedEvalRuntime.reasons.join('\n'),
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
  assert.equal(assertGitObjectClosureBudget(20_000, 128 * MIB), true,
    'a canonical 20k-object history must fit the separate packed-object enumeration cap');
  assert.throws(() => assertGitObjectClosureBudget(262_145, 1), /bounded budget/);
  assert.throws(() => assertGitObjectClosureBudget(1, 513 * MIB), /bounded budget/);
  const portableSnapshotImport = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `await import(${JSON.stringify(`file://${path.resolve('scripts/safe-runner/execution-snapshot.mjs')}`)})`], {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, PATH: '/definitely-no-git-here', GIT_DIR: '/tmp/poison-git-dir' },
  });
  assert.equal(portableSnapshotImport.status, 0, portableSnapshotImport.stderr,
    'portable refusal/module import must not eagerly require a Unix Git executable');

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
    '{"name":"agent-skills-eval","exports":{"./provider":"./provider.mjs"},"bin":{"agent-skills-eval":"cli.mjs"},"dependencies":{"tiny-dep":"1.0.0"}}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'agent-skills-eval', 'cli.mjs'),
    "#!/usr/bin/env node\nimport tiny from 'tiny-dep'; console.log(tiny);\n", { mode: 0o700 });
  assert.equal(auditedNpxPackage(snapshotRepository, 'agent-skills-eval').bin_relative, 'cli.mjs',
    'audited npx discovery must read the physical manifest without requiring a root export');
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', '@scope', 'sealed-cli'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', '@scope', 'sealed-cli',
    'package.json'), JSON.stringify({
    name: '@scope/sealed-cli', exports: { '.': './index.mjs' }, bin: 'bin/cli.mjs',
  }));
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', '@scope', 'sealed-cli', 'bin'));
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', '@scope', 'sealed-cli', 'bin',
    'cli.mjs'), '#!/usr/bin/env node\n', { mode: 0o700 });
  assert.equal(auditedNpxPackage(snapshotRepository, '@scope/sealed-cli').bin_relative,
    'bin/cli.mjs', 'scoped audited packages must resolve their physical manifest and string bin');
  assert.throws(() => auditedNpxPackage(snapshotRepository, '../escape'), /invalid execution dependency/);
  for (const builtin of ['events', 'node:events', 'fs', 'node:fs', 'fs/promises',
    'node:fs/promises']) assert.equal(packageName(builtin), null, `${builtin} is a Node builtin`);
  assert.equal(packageName('@scope/runtime/subpath'), '@scope/runtime');
  assert.equal(packageName('ordinary/subpath'), 'ordinary');
  const actualInstallRoot = process.env.LAMINA_ACTUAL_INSTALL_ROOT || process.cwd();
  if (fs.existsSync(path.join(actualInstallRoot, 'node_modules', 'agent-skills-eval',
    'package.json'))) {
    assert.equal(auditedNpxPackage(actualInstallRoot, 'agent-skills-eval').bin_relative,
      'dist/cli.js');
    assert.equal(auditedNpxPackage(actualInstallRoot, 'promptfoo').bin_relative,
      'dist/src/entrypoint.js');
  } else if (process.env.LAMINA_ACTUAL_INSTALL_ROOT) {
    assert.fail('LAMINA_ACTUAL_INSTALL_ROOT must contain the actual audited npx packages');
  }
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
  const buildEntrypoint = path.join(snapshotRepository, 'scripts', 'build-standalone-cli.mjs');
  fs.mkdirSync(path.dirname(buildEntrypoint), { recursive: true });
  fs.writeFileSync(buildEntrypoint, "export const build = true;\n");
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', 'postject'));
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'postject', 'package.json'),
    '{"name":"postject","main":"index.js"}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'postject', 'index.js'),
    "module.exports = {};\n");
  const fakeUv = path.join(fakeInfrastructure, 'uv');
  fs.writeFileSync(fakeUv, '#!/bin/sh\necho sealed uv\n', { mode: 0o700 });
  const buildSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository, command: ['/bin/sh', buildEntrypoint],
    temporaryDirectory: path.join(root, 'snapshot-build-tools'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
    environment: { LAMINA_UV_BINARY: fakeUv },
  });
  assert.equal(buildSnapshot.environment_overrides.LAMINA_UV_BINARY,
    buildSnapshot.infrastructure.uv);
  assert.equal(buildSnapshot.environment_overrides.LAMINA_NODE_BINARY,
    buildSnapshot.infrastructure.node);
  fs.writeFileSync(fakeUv, '#!/bin/sh\necho mutable replacement\n', { mode: 0o700 });
  assert.equal(fs.readFileSync(buildSnapshot.infrastructure.uv, 'utf8'),
    '#!/bin/sh\necho sealed uv\n',
  'build child tooling must execute the staged uv bytes after host-path replacement');
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
  const mutableEntrypoint = path.join(snapshotRepository, 'tests', 'fixtures',
    'safe-runner-mutable.mjs');
  fs.mkdirSync(path.dirname(mutableEntrypoint), { recursive: true });
  fs.writeFileSync(mutableEntrypoint, "import fs from 'node:fs';\n");
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', mutableEntrypoint, path.join(snapshotRepository, 'root-output.txt')],
    temporaryDirectory: path.join(root, 'snapshot-root-output'),
  }), /exact Git common lamina\/work scratch authority/,
  'an argv output must never rebind the repository root over sealed source');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', mutableEntrypoint,
      path.join(snapshotRepository, 'packages', 'cli', 'result.txt')],
    temporaryDirectory: path.join(root, 'snapshot-source-output'),
  }), /exact Git common lamina\/work scratch authority/,
  'a fixture argv output must never admit an arbitrary top-level subtree');
  const maliciousScratch = path.join(snapshotRepository, '.safe-runner-malicious');
  fs.mkdirSync(maliciousScratch);
  fs.writeFileSync(path.join(maliciousScratch, 'source.mjs'), 'export const malicious = true;\n');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', mutableEntrypoint, path.join(maliciousScratch, 'result.txt')],
    temporaryDirectory: path.join(root, 'snapshot-malicious-scratch'),
  }), /exact Git common lamina\/work scratch authority/,
  'a pre-existing source-bearing .safe-runner-* path must not disappear from sealing');
  const fixtureWork = path.join(snapshotRepository, '.git', 'lamina', 'work');
  fs.mkdirSync(fixtureWork, { recursive: true });
  const fixtureAlias = path.join(fixtureWork, 'alias');
  fs.symlinkSync(path.join(snapshotRepository, 'dist'), fixtureAlias);
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', mutableEntrypoint,
      path.join(fixtureAlias, 'result.txt')],
    temporaryDirectory: path.join(root, 'snapshot-output-alias'),
  }), /existing canonical physical directory/,
  'an ignored symlink alias must not redirect a writable binding');
  const prepareEntrypoint = path.join(snapshotRepository, 'scripts', 'prepare-retrieval-assets.mjs');
  fs.mkdirSync(path.dirname(prepareEntrypoint), { recursive: true });
  fs.writeFileSync(prepareEntrypoint, "export const prepare = true;\n");
  const ladybug = path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    '@ladybugdb', 'core');
  fs.mkdirSync(ladybug, { recursive: true });
  fs.writeFileSync(path.join(ladybug, 'package.json'),
    '{"name":"@ladybugdb/core","main":"index.js"}\n');
  fs.writeFileSync(path.join(ladybug, 'index.js'), "module.exports = {};\n");
  const collapsedOutputSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', prepareEntrypoint, path.join(snapshotRepository, 'dist', 'nested')],
    temporaryDirectory: path.join(root, 'snapshot-collapsed-output'),
  });
  assert.deepEqual(collapsedOutputSnapshot.writable_bindings
    .filter((item) => item.kind !== 'git-common-runtime').map((item) => item.source),
  [path.join(snapshotRepository, 'dist')],
  'a declared parent output must safely collapse its nested dynamic output');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', prepareEntrypoint, path.join(snapshotRepository, 'arbitrary-new-dir')],
    temporaryDirectory: path.join(root, 'snapshot-arbitrary-prepare-output'),
  }), /beneath the declared dist subtree/);
  const savedDist = path.join(snapshotRepository, 'dist.saved');
  const escapedOutput = path.join(root, 'escaped-output-target');
  fs.mkdirSync(escapedOutput);
  fs.renameSync(path.join(snapshotRepository, 'dist'), savedDist);
  fs.symlinkSync(escapedOutput, path.join(snapshotRepository, 'dist'));
  try {
    assert.throws(() => prepareExecutionSnapshot({
      cwd: snapshotRepository,
      command: ['/bin/sh', prepareEntrypoint,
        path.join(snapshotRepository, 'dist', 'must-not-exist', 'nested')],
      temporaryDirectory: path.join(root, 'snapshot-output-ancestor-alias'),
    }), /symlink escapes the repository|ancestor is not a canonical physical directory/);
    assert.equal(fs.existsSync(path.join(escapedOutput, 'must-not-exist')), false,
      'writable-root validation must not create through a symlink ancestor');
  } finally {
    fs.unlinkSync(path.join(snapshotRepository, 'dist'));
    fs.renameSync(savedDist, path.join(snapshotRepository, 'dist'));
  }
  fs.writeFileSync(path.join(snapshotRepository, 'dist', 'tracked-source.txt'), 'tracked source\n');
  assert.equal(spawnSync('git', ['add', '-f', 'dist/tracked-source.txt'], {
    cwd: snapshotRepository,
  }).status, 0);
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', prepareEntrypoint, path.join(snapshotRepository, 'dist', 'nested')],
    temporaryDirectory: path.join(root, 'snapshot-fixed-source-output'),
  }), /re-expose sealed source/,
  'fixed writable roots must also refuse tracked source overlap');
  const runtimeAuthority = path.join(snapshotRepository, '.git', 'lamina');
  const savedRuntimeAuthority = `${runtimeAuthority}.saved`;
  fs.renameSync(runtimeAuthority, savedRuntimeAuthority);
  fs.symlinkSync(path.join(snapshotRepository, 'dist'), runtimeAuthority);
  try {
    assert.throws(() => prepareExecutionSnapshot({
      cwd: snapshotRepository, command: ['/bin/sh', path.join(snapshotRepository, 'entry.mjs')],
      temporaryDirectory: path.join(root, 'snapshot-runtime-symlink'),
    }), /Git common Lamina runtime.*canonical physical directory/,
    'the writable Git-common runtime source must never follow a symlink');
  } finally {
    fs.unlinkSync(runtimeAuthority);
    fs.renameSync(savedRuntimeAuthority, runtimeAuthority);
  }

  if (process.platform === 'linux') {
  const linkedBase = path.join(root, 'linked-authority');
  const linkedPrimary = path.join(linkedBase, 'primary');
  const linkedWorktree = path.join(linkedBase, 'feature');
  fs.mkdirSync(linkedPrimary, { recursive: true });
  const linkedGit = (cwd, args) => {
    const result = spawnSync('/usr/bin/git', args, {
      cwd, encoding: 'utf8', env: {
        PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'C', LC_ALL: 'C',
      },
    });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  linkedGit(linkedPrimary, ['init', '-b', 'main']);
  linkedGit(linkedPrimary, ['config', 'user.email', 'snapshot@lamina.invalid']);
  linkedGit(linkedPrimary, ['config', 'user.name', 'Snapshot Test']);
  fs.writeFileSync(path.join(linkedPrimary, 'entry.mjs'), "export const version = 'one';\n");
  linkedGit(linkedPrimary, ['add', 'entry.mjs']);
  linkedGit(linkedPrimary, ['commit', '-m', 'first']);
  fs.writeFileSync(path.join(linkedPrimary, 'history.txt'), 'second commit\n');
  linkedGit(linkedPrimary, ['add', 'history.txt']);
  linkedGit(linkedPrimary, ['commit', '-m', 'second']);
  linkedGit(linkedPrimary, ['worktree', 'add', '-b', 'feature', linkedWorktree]);
  fs.writeFileSync(path.join(linkedWorktree, 'entry.mjs'), "export const version = 'staged';\n");
  linkedGit(linkedWorktree, ['add', 'entry.mjs']);
  const linkedHeadBefore = linkedGit(linkedWorktree, ['rev-parse', 'HEAD']);
  const linkedHistoryBefore = linkedGit(linkedWorktree, ['rev-list', 'HEAD']);
  const fsmonitorSentinel = path.join(linkedBase, 'fsmonitor-executed');
  const hostileFsmonitor = path.join(linkedBase, 'hostile-fsmonitor.sh');
  fs.writeFileSync(hostileFsmonitor,
    `#!/bin/sh\ntouch ${JSON.stringify(fsmonitorSentinel)}\nexit 1\n`, { mode: 0o700 });
  linkedGit(linkedWorktree, ['config', 'core.fsmonitor', hostileFsmonitor]);
  linkedGit(linkedWorktree, ['config', 'core.hooksPath', path.join(linkedBase, 'hostile-hooks')]);
  linkedGit(linkedWorktree, ['config', 'credential.helper', '!false']);
  fs.rmSync(fsmonitorSentinel, { force: true });
  assert.throws(() => prepareExecutionSnapshot({
    cwd: linkedWorktree, command: ['/bin/sh', path.join(linkedWorktree, 'entry.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-linked-hostile-config'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  }), /executable Git (?:setting|section)/,
  'repository-local executable config must refuse before any Git subprocess runs');
  assert.equal(fs.existsSync(fsmonitorSentinel), false);
  linkedGit(linkedWorktree, ['config', '--unset-all', 'core.fsmonitor']);
  linkedGit(linkedWorktree, ['config', '--unset-all', 'core.hooksPath']);
  linkedGit(linkedWorktree, ['config', '--unset-all', 'credential.helper']);
  fs.rmSync(fsmonitorSentinel, { force: true });
  const linkedSnapshot = prepareExecutionSnapshot({
    cwd: linkedWorktree, command: ['/bin/sh', path.join(linkedWorktree, 'entry.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-linked'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  });
  assert.equal(fs.lstatSync(path.join(linkedSnapshot.snapshot_repository, '.git')).isFile(), true,
    'a linked snapshot must retain its descriptor-copied .git pointer');
  assert.equal(linkedSnapshot.git_readonly_bindings.length, 2);
  const linkedCommonBinding = linkedSnapshot.git_readonly_bindings.find((item) =>
    item.kind === 'git-common');
  const linkedWorktreeBinding = linkedSnapshot.git_readonly_bindings.find((item) =>
    item.kind === 'git-worktree');
  assert.equal(linkedCommonBinding.target, runtimePaths(linkedWorktree).common);
  assert.ok(linkedWorktreeBinding.source.startsWith(`${linkedCommonBinding.source}${path.sep}`));
  const sealedConfig = fs.readFileSync(path.join(linkedCommonBinding.source, 'config'), 'utf8');
  assert.match(sealedConfig, /^\s*fsmonitor = false$/m);
  assert.doesNotMatch(sealedConfig, /hostile|credential|include|sshcommand/i,
    'sealed Git authority must synthesize inert structural config, never copy executable config');
  assert.equal(fs.existsSync(fsmonitorSentinel), false,
    'execution snapshot Git reads must never execute repository-local fsmonitor');
  const sealedGit = (args) => linkedGit(linkedSnapshot.snapshot_repository, [
    `--git-dir=${linkedWorktreeBinding.source}`,
    `--work-tree=${linkedSnapshot.snapshot_repository}`,
    ...args,
  ]);
  assert.equal(sealedGit(['rev-parse', 'HEAD']), linkedHeadBefore);
  assert.equal(sealedGit(['rev-list', 'HEAD']), linkedHistoryBefore,
    'the packed authority must preserve bounded reachable ancestry');
  assert.match(sealedGit(['status', '--porcelain=v1']), /^M  entry\.mjs$/m,
    'the linked worktree index must preserve staged semantics');
  assert.equal(fs.existsSync(path.join(linkedCommonBinding.source,
    'objects', 'info', 'alternates')), false,
  'sealed objects must never retain a live external alternates dependency');
  linkedGit(linkedWorktree, ['commit', '-m', 'mutate live worktree']);
  fs.writeFileSync(path.join(linkedWorktree, 'entry.mjs'), "export const version = 'live replacement';\n");
  assert.equal(sealedGit(['rev-parse', 'HEAD']), linkedHeadBefore,
    'later live ref/index mutation must not alter sealed Git authority');
  assert.match(fs.readFileSync(path.join(linkedSnapshot.snapshot_repository, 'entry.mjs'), 'utf8'),
    /version = 'staged'/, 'later live source mutation must not alter sealed bytes');
  const linkedRuntime = linkedSnapshot.writable_bindings.find((item) =>
    item.kind === 'git-common-runtime');
  assert.equal(linkedRuntime.source, path.join(runtimePaths(linkedWorktree).common, 'lamina'));
  assert.equal(linkedRuntime.target, linkedRuntime.source,
    'broker-visible graphd paths and the writable bind must use the same physical common authority');
  assert.equal(linkedSnapshot.graphd_launch_authority[0].runtime_directory, linkedRuntime.source,
    'linked graphd broker equality must use the exact mounted common runtime path');
  const linkedGraphdAuthority = linkedSnapshot.graphd_launch_authority[0];
  const cleanGraphdEnvironment = processEnvironmentAttestation(
    Buffer.from('PATH=/usr/bin\0LAMINA_SAFE_GRAPHD_RESERVATION=sealed\0'),
  );
  const linkedGraphdChild = {
    argv: linkedGraphdAuthority.argv,
    environment_attestation: cleanGraphdEnvironment,
    executable_identity: {
      dev: linkedGraphdAuthority.executable_identity.dev,
      ino: linkedGraphdAuthority.executable_identity.ino,
      uid: linkedGraphdAuthority.executable_identity.uid,
    },
  };
  assert.equal(exactGraphdLaunchAuthorized({
    ...linkedGraphdChild,
  }, {
    socket: path.join(linkedRuntime.source, 'graphd.sock'),
    lock: path.join(linkedRuntime.source, 'graphd.lock'),
  }, linkedSnapshot.graphd_launch_authority), true);
  assert.equal(exactGraphdLaunchAuthorized({
    ...linkedGraphdChild,
    executable_identity: { dev: 'spoof', ino: 'spoof', uid: 0 },
  }, {
    socket: path.join(linkedRuntime.source, 'graphd.sock'),
    lock: path.join(linkedRuntime.source, 'graphd.lock'),
  }, linkedSnapshot.graphd_launch_authority), false);
  for (const hook of [
    'NODE_OPTIONS=--require=/tmp/hostile-loader.cjs',
    'NODE_LOADER=/tmp/hostile-loader.mjs',
  ]) {
    assert.equal(exactGraphdLaunchAuthorized({
      ...linkedGraphdChild,
      environment_attestation: processEnvironmentAttestation(
        Buffer.from(`PATH=/usr/bin\0${hook}\0`),
      ),
    }, {
      socket: path.join(linkedRuntime.source, 'graphd.sock'),
      lock: path.join(linkedRuntime.source, 'graphd.lock'),
    }, linkedSnapshot.graphd_launch_authority), false,
    `${hook.split('=')[0]} must invalidate otherwise exact graphd launch authority`);
  }
  for (const environment_attestation of [
    { ...cleanGraphdEnvironment, readable: false },
    { ...cleanGraphdEnvironment, bounded: false },
    { ...cleanGraphdEnvironment, malformed: true },
  ]) {
    assert.equal(exactGraphdLaunchAuthorized({
      ...linkedGraphdChild, environment_attestation,
    }, {
      socket: path.join(linkedRuntime.source, 'graphd.sock'),
      lock: path.join(linkedRuntime.source, 'graphd.lock'),
    }, linkedSnapshot.graphd_launch_authority), false,
    'unreadable, oversized, or malformed graphd environments must fail closed');
  }
  fs.writeFileSync(path.join(linkedRuntime.source, 'write-through.marker'), 'writable graph runtime');
  assert.equal(fs.readFileSync(path.join(runtimePaths(linkedPrimary).runtime_dir,
    'write-through.marker'), 'utf8'), 'writable graph runtime');
  const linkedSandboxArgs = bubblewrapSandboxArguments({
    cwd: linkedWorktree, readyFile: path.join(root, 'linked.ready'),
    releaseFile: path.join(root, 'linked.release'), temporaryDirectory: path.join(root, 'linked-tmp'),
    command: linkedSnapshot.launch_command, masks: { hiddenDirectories: [], sockets: [] },
    executionAuthority: linkedSnapshot,
  });
  assert.ok(linkedSandboxArgs.indexOf(linkedRuntime.alias)
    < linkedSandboxArgs.indexOf(linkedCommonBinding.source));
  assert.ok(linkedSandboxArgs.indexOf(linkedCommonBinding.source)
    < linkedSandboxArgs.indexOf(linkedWorktreeBinding.source));
  assert.ok(linkedSandboxArgs.lastIndexOf(linkedRuntime.target)
    > linkedSandboxArgs.indexOf(linkedWorktreeBinding.source),
  'Git common must mount before nested worktree metadata and exact runtime write-through');
  fs.appendFileSync(path.join(linkedPrimary, '.git', 'config'),
    '\n[include]\n\tpath = /etc/gitconfig\n');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: linkedWorktree, command: ['/bin/sh', path.join(linkedWorktree, 'entry.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-linked-include'),
  }), /executable Git section include/);
  const physicalGitdirWorktree = path.join(linkedBase, 'physical-gitdir-worktree');
  const physicalGitdir = path.join(physicalGitdirWorktree, '.git');
  fs.mkdirSync(physicalGitdir, { recursive: true });
  fs.writeFileSync(path.join(physicalGitdir, 'HEAD'), `ref: refs/heads/feature\n`);
  fs.writeFileSync(path.join(physicalGitdir, 'commondir'), `${path.join(linkedPrimary, '.git')}\n`);
  assert.equal(path.resolve(physicalGitdirWorktree,
    linkedGit(physicalGitdirWorktree, ['rev-parse', '--git-common-dir'])),
  path.join(linkedPrimary, '.git'),
  'the adversary must be a Git-recognized physical .git/commondir layout');
  const physicalGitdirProof = writableWorktreeProof(physicalGitdirWorktree, []);
  assert.equal(physicalGitdirProof.ok, false);
  assert.match(physicalGitdirProof.reason, /physical \.git directories with external commondir/,
    'filesystem discovery must refuse physical .git/commondir before any trusted Git spawn');
  }

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
    graphdLaunchAuthorized: (child) => Array.isArray(child.argv)
      && child.argv[0] === process.execPath
      && child.argv[1] === '/repo/packages/cli/lib/graph-runtime/server.mjs'
      && child.argv[2] === '/repo'
      && child.executable_identity?.dev === 'sealed-node-dev'
      && child.executable_identity?.ino === 'sealed-node-ino',
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
  for (const [label, argv] of [
    ['spoof argv', [process.execPath, '/tmp/spoof.mjs', '--graphd', '/repo']],
    ['spoof script', [process.execPath, '/tmp/graph-runtime/server.mjs', '/repo']],
    ['spoof executable', ['/tmp/node', '/repo/packages/cli/lib/graph-runtime/server.mjs', '/repo']],
    ['spoof process title', [process.execPath, '/repo/packages/cli/lib/graph-runtime/server.mjs', '/repo']],
  ]) {
    const spoof = {
      pid: 42000 + authorityRecords.length, ppid: requester.pid,
      start_ticks: `spoof-${authorityRecords.length}`, argv, command: argv.join(' '), cwd: '/repo',
      executable_identity: label === 'spoof process title'
        ? { dev: 'bin-sh-dev', ino: 'bin-sh-ino', uid: 0 }
        : { dev: 'sealed-node-dev', ino: 'sealed-node-ino', uid: 0 },
    };
    authorityRecords.push(spoof);
    const spoofReservation = authorizeBrokerRequest({
      operation: 'reserve_graphd', requester,
      socket: `/repo/.git/${label.replaceAll(' ', '-')}/graphd.sock`,
      lock: `/repo/.git/${label.replaceAll(' ', '-')}/graphd.lock`,
    }, authority);
    assert.equal(spoofReservation.ok, true);
    assert.equal(authorizeBrokerRequest({
      operation: 'bind_graphd', requester, reservation: spoofReservation.reservation,
      child: { pid: spoof.pid, start_ticks: spoof.start_ticks },
    }, authority).ok, false, `${label} must not gain the managed-daemon exception`);
  }
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

  const responseDeadlineDirectory = path.join(root, 'broker-response-deadline');
  fs.mkdirSync(responseDeadlineDirectory);
  const responseDeadlineBroker = await createProofBroker(responseDeadlineDirectory, authority, {
    maxConnections: 16, idleTimeoutMs: 60, maxRequestsPerWindow: 64, requestWindowMs: 1_000,
  });
  const validHalfOpenClients = await Promise.all(Array.from({ length: 16 }, () =>
    new Promise((resolve, reject) => {
      const socket = net.createConnection({ path: responseDeadlineBroker.socketPath, allowHalfOpen: true });
      const deadline = setTimeout(() => { socket.destroy(); reject(new Error('half-open response timeout')); }, 500);
      socket.setEncoding('utf8');
      socket.once('connect', () => socket.write(contextFrame));
      socket.once('data', (value) => {
        clearTimeout(deadline);
        assert.equal(JSON.parse(value.trim()).ok, true);
        resolve(socket);
      });
      socket.once('error', reject);
    })));
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal((await brokerRpc(responseDeadlineBroker, contextFrame)).ok, true,
    'valid clients withholding FIN must be reclaimed by the post-response deadline');
  for (const socket of validHalfOpenClients) socket.destroy();
  await responseDeadlineBroker.close();

  const authorizedGraphd = {
    pid: 41001, ppid: requester.pid, start_ticks: '100',
    command: `${process.execPath} /repo/packages/cli/lib/graph-runtime/server.mjs /repo`,
    argv: [process.execPath, '/repo/packages/cli/lib/graph-runtime/server.mjs', '/repo'],
    cwd: '/repo',
    executable_identity: { dev: 'sealed-node-dev', ino: 'sealed-node-ino', uid: 0 },
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
  const sealedIdentityA = bindExecutionSnapshotIdentity({ digest: 'a'.repeat(64) }, 'b'.repeat(64));
  const sealedIdentityB = bindExecutionSnapshotIdentity({ digest: 'a'.repeat(64) }, 'c'.repeat(64));
  recordPromotion(root, 'small', auditedEvidence, 'sealed-unit-workload',
    auditedEvidence.command, sealedIdentityA);
  assert.equal(checkPromotion(root, 'medium', 'sealed-unit-workload', auditedEvidence.command,
    sealedIdentityA).ok, true);
  assert.equal(checkPromotion(root, 'medium', 'sealed-unit-workload', auditedEvidence.command,
    sealedIdentityB).ok, false,
  'small-to-medium promotion must bind dependency/tool bytes through the execution snapshot digest');
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
  if (process.platform === 'linux') {
    const hostilePath = path.join(sourceRepository, 'hostile-path');
    const pathGitSentinel = path.join(sourceRepository, 'path-git-executed');
    const localFsmonitorSentinel = path.join(sourceRepository, 'local-fsmonitor-executed');
    const localFsmonitor = path.join(sourceRepository, 'local-fsmonitor.sh');
    fs.mkdirSync(hostilePath);
    fs.writeFileSync(path.join(hostilePath, 'git'),
      `#!/bin/sh\ntouch ${JSON.stringify(pathGitSentinel)}\nexit 99\n`, { mode: 0o700 });
    fs.writeFileSync(localFsmonitor,
      `#!/bin/sh\ntouch ${JSON.stringify(localFsmonitorSentinel)}\nexit 1\n`, { mode: 0o700 });
    assert.equal(spawnSync('/usr/bin/git', ['config', 'core.fsmonitor', localFsmonitor], {
      cwd: sourceRepository,
    }).status, 0);
    const originalPath = process.env.PATH;
    process.env.PATH = hostilePath;
    try {
      const unsafeGitProof = writableWorktreeProof(sourceRepository, []);
      assert.equal(unsafeGitProof.ok, false);
      assert.match(unsafeGitProof.reason, /unsafe Git authority.*core\.fsmonitor/);
      assert.throws(() => repositorySourceDigest(sourceRepository), /core\.fsmonitor/);
      assert.equal(fs.existsSync(pathGitSentinel), false);
      assert.equal(fs.existsSync(localFsmonitorSentinel), false);
      spawnSync('/usr/bin/git', ['config', '--unset-all', 'core.fsmonitor'], {
        cwd: sourceRepository,
      });
      assert.equal(writableWorktreeProof(sourceRepository, []).ok, true);
      assert.match(repositorySourceDigest(sourceRepository), /^[a-f0-9]{64}$/);
    } finally {
      process.env.PATH = originalPath;
    }
    assert.equal(fs.existsSync(pathGitSentinel), false,
      'controller Git must never resolve through inherited PATH');
    assert.equal(fs.existsSync(localFsmonitorSentinel), false,
      'controller Git must force repository-local fsmonitor execution off');
    fs.rmSync(pathGitSentinel, { force: true });
    fs.rmSync(localFsmonitorSentinel, { force: true });
    fs.rmSync(localFsmonitor, { force: true });
    fs.rmSync(hostilePath, { recursive: true, force: true });
  }
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
  assert.equal(unpromoted.promotion.deferred_to_execution_snapshot, true);
  assert.doesNotMatch(unpromoted.reasons.join('\n'), /tier promotion requires successful cleanup/,
    'production promotion is decided only after dependency/tool launch bytes are sealed');

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
