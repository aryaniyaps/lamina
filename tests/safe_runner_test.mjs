#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import {
  adapterProbe, assertAdapterShape, boundedProbeFailure, systemdKillControlSupported,
} from '../scripts/safe-runner/adapter.mjs';
import { authorizeBrokerRequest } from '../scripts/safe-runner/broker.mjs';
import { DEFAULTS, GIB, MIB, SELF_TEST_CASE_IDS } from '../scripts/safe-runner/constants.mjs';
import { safeRunnerContext } from '../scripts/safe-runner/context.mjs';
import {
  deriveLimits,
  parseHostPageSize,
  validateLimitOverrides,
} from '../scripts/safe-runner/envelope.mjs';
import {
  ownedDirectoryIdentity, removeOwnedDirectory, removeOwnedRuntimePaths,
} from '../scripts/safe-runner/filesystem.mjs';
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
import { commandOwnership, preflightRun } from '../scripts/safe-runner/preflight.mjs';
import {
  existingLaminaProcesses, identityAlive, isLaminaProcessCommand, processIdentity,
} from '../scripts/safe-runner/processes.mjs';
import { redactCommand, redactText } from '../scripts/safe-runner/redaction.mjs';
import { stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
import {
  baseReport,
  finishReport,
  validateReport,
  writeReport,
  writeReportWithFallback,
} from '../scripts/safe-runner/report.mjs';
import { boundedDiagnosticText, outcomeForStop } from '../scripts/safe-runner/runner.mjs';
import { boundedCaseError, runAdversarialSelfTests } from '../scripts/safe-runner/self-test.mjs';
import {
  acquireConcurrencyLock,
  checkPromotion,
  checkSafetyRetry,
  readAttestation,
  recordPromotion,
  recordRunAttempt,
  clearRunAttempt,
  recordSafetyLimit,
  promotionCommandDigest,
  promotionImplementationDigest,
  productionLockDirectory,
  writeAttestation,
} from '../scripts/safe-runner/state.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-unit-'));
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'state');

try {
  const unownedSamePrefix = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-unowned-'));
  assert.throws(
    () => removeOwnedDirectory(unownedSamePrefix, 'lamina-safe-runner-', null),
    /refusing to remove non-runner directory/,
  );
  assert.equal(fs.existsSync(unownedSamePrefix), true);
  fs.rmSync(unownedSamePrefix, { recursive: true, force: true });
  const symlinkTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-target-'));
  const symlinkPath = `${path.join(os.tmpdir(), 'lamina-safe-runner-symlink')}-${process.pid}-${Date.now()}`;
  fs.symlinkSync(symlinkTarget, symlinkPath);
  assert.throws(() => ownedDirectoryIdentity(symlinkPath), /not a physical directory/);
  assert.throws(
    () => removeOwnedDirectory(symlinkPath, 'lamina-safe-runner-', {
      path: symlinkPath, dev: '0', ino: '0',
    }),
    /ownership identity changed/,
  );
  assert.equal(fs.existsSync(symlinkTarget), true);
  fs.rmSync(symlinkPath, { force: true });
  fs.rmSync(symlinkTarget, { recursive: true, force: true });
  const ownedRuntime = path.join(root, 'owned-runtime');
  fs.mkdirSync(ownedRuntime);
  const ownedRuntimeIdentity = ownedDirectoryIdentity(ownedRuntime);
  const ownedSocket = path.join(ownedRuntime, 'graphd.sock');
  const ownedLock = path.join(ownedRuntime, 'graphd.lock');
  const ownedOperations = path.join(ownedRuntime, 'graphd.operations');
  fs.mkdirSync(ownedOperations);
  let ownedOperationsIdentity = ownedDirectoryIdentity(ownedOperations);
  const ownedGraphd = { pid: 42001, start_ticks: '4200100' };
  const ownedNonce = 'a'.repeat(32);
  let ownedOperationClaim = path.join(
    ownedOperations, `${ownedGraphd.pid}-${ownedGraphd.start_ticks}-${ownedNonce}.json`,
  );
  const writeOwnedClaim = () => fs.writeFileSync(ownedOperationClaim, JSON.stringify({
    type: 'graphd', ...ownedGraphd, nonce: ownedNonce,
  }));
  const ownedCandidates = () => [
    {
      path: ownedSocket,
      parent_identity: ownedRuntimeIdentity,
      child_identity: ownedGraphd,
      operation_claim: ownedOperationClaim,
      operations_identity: ownedOperationsIdentity,
    },
    {
      path: ownedLock,
      parent_identity: ownedRuntimeIdentity,
      child_identity: ownedGraphd,
      operation_claim: ownedOperationClaim,
      operations_identity: ownedOperationsIdentity,
    },
  ];
  fs.writeFileSync(ownedSocket, 'stale socket');
  fs.writeFileSync(ownedLock, JSON.stringify({
    pid: ownedGraphd.pid, start_ticks: ownedGraphd.start_ticks,
  }));
  writeOwnedClaim();
  if (process.platform === 'linux') {
    const replacementIdentity = processIdentity(process.pid);
    const replacementNonce = 'b'.repeat(32);
    const replacementClaim = path.join(
      ownedOperations,
      `${replacementIdentity.pid}-${replacementIdentity.start_ticks}-${replacementNonce}.json`,
    );
    fs.writeFileSync(replacementClaim, JSON.stringify({
      type: 'graphd', ...replacementIdentity, nonce: replacementNonce,
    }));
    assert.deepEqual(removeOwnedRuntimePaths(ownedCandidates()).sort(), [
      ownedLock, ownedOperationClaim, ownedSocket,
    ].sort(), 'a live replacement graphd claim must fence cleanup from every registered runtime path');
    fs.rmSync(replacementClaim);
    assert.deepEqual(removeOwnedRuntimePaths(ownedCandidates()), []);
    fs.mkdirSync(ownedOperations);
    ownedOperationsIdentity = ownedDirectoryIdentity(ownedOperations);
    ownedOperationClaim = path.join(
      ownedOperations, `${ownedGraphd.pid}-${ownedGraphd.start_ticks}-${ownedNonce}.json`,
    );
    fs.writeFileSync(ownedSocket, 'different graphd socket');
    fs.writeFileSync(ownedLock, JSON.stringify({
      pid: ownedGraphd.pid, start_ticks: 'different-start',
    }));
    writeOwnedClaim();
    assert.deepEqual(removeOwnedRuntimePaths(ownedCandidates()).sort(), [
      ownedLock, ownedOperationClaim, ownedSocket,
    ].sort(), 'another graphd lock identity must never be deleted');
  }
  fs.rmSync(ownedSocket);
  fs.rmSync(ownedLock);
  fs.rmSync(ownedOperationClaim);
  fs.rmdirSync(ownedOperations);
  const protectedFile = path.join(root, 'protected-file');
  fs.writeFileSync(protectedFile, 'preserve');
  fs.symlinkSync(protectedFile, ownedSocket);
  assert.deepEqual(removeOwnedRuntimePaths([
    { path: ownedSocket, parent_identity: ownedRuntimeIdentity },
  ]), [ownedSocket]);
  assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'preserve');
  fs.rmSync(ownedSocket);
  fs.renameSync(ownedRuntime, `${ownedRuntime}-original`);
  fs.mkdirSync(ownedRuntime);
  fs.writeFileSync(ownedLock, 'replacement');
  assert.deepEqual(removeOwnedRuntimePaths([
    { path: ownedLock, parent_identity: ownedRuntimeIdentity },
  ]), [ownedLock]);
  assert.equal(fs.existsSync(ownedLock), true, 'replacement runtime identity must never be deleted');
  const ownedTemporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-owned-'));
  const ownedIdentity = ownedDirectoryIdentity(ownedTemporary);
  assert.equal(removeOwnedDirectory(ownedTemporary, 'lamina-safe-runner-', ownedIdentity), true);

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
  assert.equal(adapterProbe('darwin').production_enforcement, false);
  assert.equal(adapterProbe('win32').id, 'portable-process-group-small-only');
  assert.equal(
    boundedProbeFailure({ status: 1, signal: null, stderr: `denied\n${'x'.repeat(1_000)}` }),
    `exit=1; output=${`denied ${'x'.repeat(1_000)}`.slice(0, 500)}`,
  );
  assert.equal(systemdKillControlSupported({ status: 1, stderr: 'Unit not loaded' }), true);
  assert.equal(systemdKillControlSupported({
    status: 1, stderr: "systemctl: unrecognized option '--kill-who=all'",
  }), false);
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
  assert.equal(commandOwnership(['npx', 'agent-skills-eval', '--config', 'evals/agent-skills-eval.yaml']).proven, true);
  assert.equal(commandOwnership(['npx', '--call=docker run image', 'agent-skills-eval']).proven, false);
  assert.equal(commandOwnership(['npx', '-c', 'docker run image', 'promptfoo']).proven, false);
  const wrapper = path.join(root, 'wrapper.sh');
  fs.writeFileSync(wrapper, '#!/bin/sh\nexec harbor run "$@"\n');
  assert.equal(commandOwnership(['/bin/sh', wrapper], root).proven, false);
  assert.equal(commandOwnership(['node', 'benchmarks/lb6/pilot/scripts/run-three-arm.mjs']).proven, false);
  assert.equal(commandOwnership([process.execPath, path.join(process.cwd(), 'tests/fixtures/safe-runner-adversary.mjs'), 'success'], root).proven, true);
  assert.equal(commandOwnership(['node', 'tests/tiny.mjs']).proven, false);
  const oversizedWrapper = path.join(root, 'oversized-wrapper.mjs');
  fs.writeFileSync(oversizedWrapper, `${' '.repeat(70 * 1024)}\n`);
  assert.equal(commandOwnership([process.execPath, oversizedWrapper], root).proven, false);
  assert.deepEqual(redactCommand(['tool', '--token', 'secret-value', '--api-key=abc']), [
    'tool', '--token', '[REDACTED]', '--api-key=[REDACTED]',
  ]);
  assert.equal(redactText('Authorization: Bearer abc.def'), 'Authorization: Bearer [REDACTED]');
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
  const brokerRoot = path.join(root, 'broker-repository');
  fs.mkdirSync(brokerRoot);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: brokerRoot }).status, 0);
  const brokerRuntime = path.join(brokerRoot, '.git', 'lamina');
  fs.mkdirSync(brokerRuntime);
  const brokerSocket = path.join(brokerRuntime, 'graphd.sock');
  const brokerLock = path.join(brokerRuntime, 'graphd.lock');
  const brokerOperations = path.join(brokerRuntime, 'graphd.operations');
  fs.mkdirSync(brokerOperations);
  const graphdServer = path.resolve('packages/cli/lib/graph-runtime/server.mjs');
  const digestFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const authority = {
    runId: 'unit', tier: 'small', adapter: 'linux-systemd-cgroup-v2',
    unit: 'lamina-safe-unit.scope', cgroup: '/unit',
    enforcement: { memory_max_bytes: 1, memory_high_bytes: 1, pids_max: 1 },
    registrations: brokerRegistrations,
    records: () => authorityRecords,
    arguments: () => [process.execPath, '/proc/self/fd/3', brokerRoot],
    openFileDigest: () => digestFile(graphdServer),
    executableDigest: () => digestFile(process.execPath),
    environment: () => ({}),
    register: (record) => brokerRegistrations.push(record),
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

  const authorizedGraphd = {
    pid: 41001, ppid: requester.pid, start_ticks: '100',
    command: `${process.execPath} /proc/self/fd/3 ${brokerRoot}`,
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
    `${process.execPath} tests/tiny.mjs /repo/packages/cli/lib/graph-runtime/server.mjs`,
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
    const reusedPidRuntime = path.join(root, 'reused-pid-runtime');
    fs.mkdirSync(reusedPidRuntime);
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    let unrelatedIdentity = null;
    const unrelatedDeadline = Date.now() + 1_000;
    while (!unrelatedIdentity && Date.now() < unrelatedDeadline) {
      unrelatedIdentity = processIdentity(unrelated.pid);
      if (!unrelatedIdentity) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(unrelatedIdentity);
    const staleIdentity = { ...unrelatedIdentity, start_ticks: `${unrelatedIdentity.start_ticks}0` };
    const staleLock = path.join(reusedPidRuntime, 'graphd.lock');
    fs.writeFileSync(staleLock, JSON.stringify(staleIdentity));
    try {
      await stopIncompatibleServer({
        root,
        runtime_dir: reusedPidRuntime,
        lock: staleLock,
        token: path.join(reusedPidRuntime, 'graphd.token'),
        socket: path.join(reusedPidRuntime, 'graphd.sock'),
      });
      assert.equal(identityAlive(unrelatedIdentity), true,
        'a stale graphd PID with mismatched start ticks must never signal the reuse victim');
    } finally {
      unrelated.kill('SIGKILL');
      await once(unrelated, 'exit');
    }
    const graphdRoot = path.join(root, 'source-graphd');
    fs.mkdirSync(graphdRoot);
    assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: graphdRoot }).status, 0);
    const sourceGraphd = spawn(process.execPath, [
      path.resolve('packages/cli/lib/graph-runtime/server.mjs'), graphdRoot,
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
    const concurrentRoot = path.join(root, 'concurrent-graphd');
    fs.mkdirSync(concurrentRoot);
    assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: concurrentRoot }).status, 0);
    const concurrentRuntime = path.join(concurrentRoot, '.git', 'lamina');
    fs.mkdirSync(concurrentRuntime);
    fs.writeFileSync(path.join(concurrentRuntime, 'graphd.lock'), JSON.stringify({
      pid: 999_999, start_ticks: '1',
    }));
    const fixtureServer = path.resolve('tests/fixtures/graph-runtime/server.mjs');
    const contenders = [0, 1].map(() => spawn(
      process.execPath, [fixtureServer, concurrentRoot], { stdio: 'ignore' },
    ));
    await new Promise((resolve) => setTimeout(resolve, 250));
    let liveContenders = contenders.filter((child) => child.exitCode === null);
    assert.ok(liveContenders.length <= 1,
      'sole-live-claim startup serialization must never admit two graphd writers');
    if (liveContenders.length === 0) {
      liveContenders = [spawn(process.execPath, [fixtureServer, concurrentRoot], { stdio: 'ignore' })];
    }
    const winner = liveContenders[0];
    try {
      const winnerDeadline = Date.now() + 2_000;
      let winnerLock = null;
      while (Date.now() < winnerDeadline) {
        try { winnerLock = JSON.parse(fs.readFileSync(path.join(concurrentRuntime, 'graphd.lock'))); } catch {}
        if (winnerLock?.pid === winner.pid) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(winnerLock?.pid, winner.pid);
    } finally {
      for (const contender of contenders.concat(liveContenders)) {
        if (contender.exitCode === null) {
          contender.kill('SIGTERM');
          await once(contender, 'exit');
        }
      }
    }
  }

  const managedRegistrations = [{
    pid: 41001,
    start_ticks: '100',
    role: 'graphd',
    socket: brokerSocket,
    lock: brokerLock,
    operation_claim: path.join(brokerOperations, `41001-100-${'c'.repeat(32)}.json`),
    operations_identity: ownedDirectoryIdentity(brokerOperations),
  }];
  fs.writeFileSync(managedRegistrations[0].operation_claim, JSON.stringify({
    type: 'graphd', pid: 41001, start_ticks: '100', nonce: 'c'.repeat(32),
  }));
  const graphdRecord = { ...authorizedGraphd, ppid: 1 };
  const graphdWorker = {
    pid: 41002, ppid: graphdRecord.pid, start_ticks: '101', command: 'retrieval_worker.py',
  };
  assert.deepEqual(registeredManagedGraphd(managedRegistrations, [graphdRecord]), [{
    ...graphdRecord,
    managed_socket: managedRegistrations[0].socket,
    managed_lock: managedRegistrations[0].lock,
    managed_operation_claim: managedRegistrations[0].operation_claim,
  }]);
  authorityRecords.push(graphdRecord);
  assert.equal(authorizeBrokerRequest({
    operation: 'register_graphd',
    requester,
    child: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
    root: brokerRoot,
    runtime_dir: brokerRuntime,
    socket: managedRegistrations[0].socket,
    lock: managedRegistrations[0].lock,
  }, authority).ok, true);
  assert.equal(brokerRegistrations.length, 1);
  assert.equal(authorizeBrokerRequest({
    operation: 'register_graphd', requester,
    child: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
    root: brokerRoot,
    runtime_dir: brokerRuntime,
    socket: managedRegistrations[0].socket,
    lock: managedRegistrations[0].lock,
  }, {
    ...authority,
    openFileDigest: () => digestFile(path.resolve('tests/tiny.mjs')),
  }).ok, false, 'trusted bytes restored at the mutable script path must not authenticate different executing bytes');
  assert.equal(authorizeBrokerRequest({
    operation: 'register_graphd', requester,
    child: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
    root: brokerRoot,
    runtime_dir: brokerRuntime,
    socket: managedRegistrations[0].socket,
    lock: managedRegistrations[0].lock,
  }, {
    ...authority,
    environment: () => ({ NODE_OPTIONS: '--require=arbitrary-code.cjs' }),
  }).ok, false, 'a trusted script descriptor must not authorize a code-injected Node process');
  assert.equal(authorizeBrokerRequest({
    operation: 'register_graphd', requester,
    child: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
    root: brokerRoot,
    runtime_dir: brokerRuntime,
    socket: managedRegistrations[0].socket,
    lock: managedRegistrations[0].lock,
  }, {
    ...authority,
    arguments: () => [process.execPath, '-e', 'setInterval(() => {}, 1000)', graphdServer, brokerRoot],
  }).ok, false, 'a graphd-looking argument must not replace the executed script position');
  fs.writeFileSync(brokerLock, JSON.stringify({ pid: 99999, start_ticks: 'other-graphd' }));
  assert.equal(authorizeBrokerRequest({
    operation: 'register_graphd', requester,
    child: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
    root: brokerRoot,
    runtime_dir: brokerRuntime,
    socket: managedRegistrations[0].socket,
    lock: managedRegistrations[0].lock,
  }, authority).ok, false, 'a pre-existing graphd lock must match the registered child identity');
  fs.rmSync(brokerLock);
  const duplicateClaim = path.join(brokerOperations, `41001-100-${'d'.repeat(32)}.json`);
  fs.writeFileSync(duplicateClaim, JSON.stringify({
    type: 'graphd', pid: 41001, start_ticks: '100', nonce: 'd'.repeat(32),
  }));
  assert.equal(authorizeBrokerRequest({
    operation: 'register_graphd', requester,
    child: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
    root: brokerRoot,
    runtime_dir: brokerRuntime,
    socket: managedRegistrations[0].socket,
    lock: managedRegistrations[0].lock,
  }, authority).ok, false, 'a child must have exactly one identity-bound runtime operation claim');
  fs.rmSync(duplicateClaim);
  assert.equal(authorizeBrokerRequest({
    operation: 'register_graphd', requester,
    child: { pid: graphdRecord.pid, start_ticks: 'forged' },
    root: brokerRoot,
    runtime_dir: brokerRuntime,
    socket: managedRegistrations[0].socket,
    lock: managedRegistrations[0].lock,
  }, authority).ok, false, 'payload cannot self-assert a graphd identity');
  assert.equal(authorizeBrokerRequest({
    operation: 'register_graphd',
    requester,
    child: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
    root: brokerRoot,
    runtime_dir: brokerRuntime,
    socket: 'relative.sock',
    lock: 'relative.lock',
  }, authority).ok, false);
  assert.equal(authorizeBrokerRequest({
    operation: 'register_graphd', requester,
    child: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
    root: brokerRoot,
    runtime_dir: path.join(root, 'unrelated-runtime'),
    socket: path.join(root, 'unrelated-runtime', 'graphd.sock'),
    lock: path.join(root, 'unrelated-runtime', 'graphd.lock'),
  }, authority).ok, false, 'watchdog paths must be derived from the declared graph root');
  assert.equal(brokerRegistrations[0].runtime_identity.path, fs.realpathSync.native(brokerRuntime));
  assert.equal(
    classifyRemainingDescendants(managedRegistrations, [graphdRecord, graphdWorker]).kind,
    'managed_graphd',
  );
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

  if (process.platform === 'linux') {
    const claims = path.join(root, 'production-locks');
    fs.mkdirSync(claims, { recursive: true });
    fs.writeFileSync(path.join(claims, 'stale.json'), JSON.stringify({
      pid: process.pid, start_ticks: 'stale', nonce: 'never-reused',
    }));
    const lock = acquireConcurrencyLock({ directory: claims });
    assert.throws(() => acquireConcurrencyLock({ directory: claims }), /another medium\/large safe-runner/);
    assert.equal(lock.release(), true);
    assert.deepEqual(fs.readdirSync(claims), []);
  }
  const globalLock = productionLockDirectory();
  process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'different-state');
  assert.equal(productionLockDirectory(), globalLock, 'state override must not split the host-global lock');

  assert.throws(() => recordPromotion(root, 'small', { outcome: 'success' }), /verified cleanup/);
  assert.throws(() => recordPromotion(root, 'small', report), /--workload/);
  const basicPromotionRepository = path.join(root, 'basic-promotion-repository');
  fs.mkdirSync(basicPromotionRepository);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: basicPromotionRepository }).status, 0);
  const promotionScript = path.join(basicPromotionRepository, 'promotion-workload.mjs');
  fs.writeFileSync(promotionScript, 'process.exit(0);\n');
  assert.equal(spawnSync('git', ['add', 'promotion-workload.mjs'], {
    cwd: basicPromotionRepository,
  }).status, 0);
  assert.equal(spawnSync('git', [
    '-c', 'user.name=Lamina Test', '-c', 'user.email=lamina@example.invalid',
    'commit', '--quiet', '-m', 'fixture',
  ], { cwd: basicPromotionRepository }).status, 0);
  const promotionReport = structuredClone(report);
  promotionReport.command = [process.execPath, promotionScript];
  recordPromotion(basicPromotionRepository, 'small', promotionReport, 'unit-workload');
  assert.equal(checkPromotion(
    basicPromotionRepository, 'medium', 'unit-workload', promotionReport.command,
  ).ok, true);
  assert.equal(checkPromotion(
    basicPromotionRepository, 'medium', 'unit-workload', [...promotionReport.command, '--changed'],
  ).ok, false);
  assert.equal(checkPromotion(
    basicPromotionRepository, 'medium', 'unrelated-workload', promotionReport.command,
  ).ok, false);
  assert.equal(promotionCommandDigest(promotionReport.command), promotionCommandDigest(redactCommand(promotionReport.command)));
  const initialImplementation = promotionImplementationDigest(
    basicPromotionRepository, promotionReport.command,
  );
  fs.writeFileSync(promotionScript, 'process.exit(1);\n');
  assert.notEqual(
    promotionImplementationDigest(basicPromotionRepository, promotionReport.command),
    initialImplementation,
  );
  assert.equal(checkPromotion(
    basicPromotionRepository, 'medium', 'unit-workload', promotionReport.command,
  ).ok, false,
    'changing the implementation behind the same argv must invalidate promotion');
  const changedPromotion = structuredClone(promotionReport);
  changedPromotion.command.push('--changed');
  assert.throws(
    () => recordPromotion(basicPromotionRepository, 'medium', changedPromotion, 'unit-workload'),
    /already bound to a different command or implementation/,
  );
  const promotionRepository = path.join(root, 'promotion-repository');
  fs.mkdirSync(promotionRepository);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: promotionRepository }).status, 0);
  const promotionEntrypoint = path.join(promotionRepository, 'entrypoint.mjs');
  const promotionDependency = path.join(promotionRepository, 'dependency.mjs');
  fs.writeFileSync(promotionEntrypoint, "import './dependency.mjs';\n");
  fs.writeFileSync(promotionDependency, 'export const value = 1;\n');
  assert.equal(spawnSync('git', ['add', 'entrypoint.mjs', 'dependency.mjs'], {
    cwd: promotionRepository,
  }).status, 0);
  assert.equal(spawnSync('git', [
    '-c', 'user.name=Lamina Test', '-c', 'user.email=lamina@example.invalid',
    'commit', '--quiet', '-m', 'fixture',
  ], { cwd: promotionRepository }).status, 0);
  const transitiveReport = structuredClone(report);
  transitiveReport.command = [process.execPath, promotionEntrypoint];
  recordPromotion(promotionRepository, 'small', transitiveReport, 'transitive-workload');
  assert.equal(checkPromotion(
    promotionRepository, 'medium', 'transitive-workload', transitiveReport.command,
  ).ok, true);
  fs.writeFileSync(promotionDependency, 'export const value = 2;\n');
  assert.equal(checkPromotion(
    promotionRepository, 'medium', 'transitive-workload', transitiveReport.command,
  ).ok, false, 'changing a transitive repository source must invalidate promotion');
  const outsideGit = path.join(root, 'outside-git');
  fs.mkdirSync(outsideGit);
  const outsideImplementation = promotionImplementationDigest(outsideGit, transitiveReport.command);
  fs.writeFileSync(promotionDependency, 'export const value = 3;\n');
  assert.notEqual(promotionImplementationDigest(outsideGit, transitiveReport.command), outsideImplementation,
    'an absolute audited entrypoint must retain its Git source authority from a non-Git cwd');
  const oversizedSource = path.join(promotionRepository, 'oversized-source.mjs');
  fs.writeFileSync(oversizedSource, Buffer.alloc((16 * 1024 * 1024) + 1));
  const oversizedStat = fs.statSync(oversizedSource);
  const oversizedImplementation = promotionImplementationDigest(
    promotionRepository, transitiveReport.command,
  );
  fs.writeFileSync(oversizedSource, Buffer.alloc((16 * 1024 * 1024) + 1, 1));
  fs.utimesSync(oversizedSource, oversizedStat.atime, oversizedStat.mtime);
  assert.notEqual(
    promotionImplementationDigest(promotionRepository, transitiveReport.command),
    oversizedImplementation,
    'large changed source content must invalidate promotion even when size and mtime are restored',
  );
  fs.rmSync(oversizedSource);
  const limitedReport = structuredClone(report);
  limitedReport.termination.limit = 'timeout';
  recordSafetyLimit(root, report.command, report.limits, limitedReport);
  assert.equal(checkSafetyRetry(root, report.command, report.limits).ok, false);
  const retryAlias = `${root}-retry-alias`;
  fs.symlinkSync(root, retryAlias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(checkSafetyRetry(retryAlias, report.command, report.limits).ok, false,
    'a physical repository alias must not select a fresh retry shard');
  fs.rmSync(retryAlias, { force: true });
  assert.equal(checkSafetyRetry(root, [...report.command, '--changed'], report.limits).ok, true);
  assert.equal(checkSafetyRetry(root, report.command, {
    ...report.limits, timeout_ms: report.limits.timeout_ms - 1,
  }).ok, false, 'limit-only changes must not bypass the retry fence');
  const otherLimitedReport = structuredClone(limitedReport);
  otherLimitedReport.command.push('--other');
  recordSafetyLimit(root, otherLimitedReport.command, report.limits, otherLimitedReport);
  assert.equal(checkSafetyRetry(root, report.command, report.limits).ok, false,
    'recording another failed workload must retain prior retry fences');
  for (let index = 0; index < 129; index += 1) {
    const boundedCommand = ['node', '-e', `ledger-${index}`];
    recordSafetyLimit(root, boundedCommand, report.limits, {
      ...limitedReport, run_id: `ledger-${index}`, command: boundedCommand,
    });
  }
  assert.equal(checkSafetyRetry(root, ['node', '-e', 'ledger-0'], report.limits).ok, false,
    'later distinct failures must never evict an earlier retry fence');
  const stateModule = pathToFileURL(path.resolve('scripts/safe-runner/state.mjs')).href;
  const concurrentWriter = `
    import { recordSafetyLimit } from ${JSON.stringify(stateModule)};
    const id = process.env.LAMINA_LEDGER_WRITER_ID;
    const command = ['node', '-e', id];
    recordSafetyLimit(process.env.LAMINA_LEDGER_WRITER_CWD, command, {}, {
      run_id: id, termination: { limit: 'timeout' },
    });
  `;
  const concurrentIds = Array.from({ length: 12 }, (_, index) => `concurrent-${index}`);
  const concurrentStatuses = await Promise.all(concurrentIds.map(async (id) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', concurrentWriter], {
      stdio: 'ignore',
      env: {
        ...process.env,
        LAMINA_LEDGER_WRITER_ID: id,
        LAMINA_LEDGER_WRITER_CWD: root,
      },
    });
    return (await once(child, 'exit'))[0];
  }));
  assert.deepEqual(concurrentStatuses, concurrentStatuses.map(() => 0));
  for (const id of concurrentIds) {
    assert.equal(checkSafetyRetry(root, ['node', '-e', id], {}).ok, false,
      'concurrent distinct writers must retain every fence');
  }
  const activeCommand = [...report.command, '--controller-may-crash'];
  recordRunAttempt(root, activeCommand, report.limits, report);
  const overlappingReport = { ...report, run_id: `${report.run_id}-overlap` };
  recordRunAttempt(root, activeCommand, report.limits, overlappingReport);
  assert.equal(checkSafetyRetry(root, activeCommand, report.limits).ok, false);
  clearRunAttempt(root, activeCommand, report.limits, report.run_id);
  assert.equal(checkSafetyRetry(root, activeCommand, report.limits).ok, false,
    'clearing one run must not erase an overlapping active attempt');
  clearRunAttempt(root, activeCommand, report.limits, overlappingReport.run_id);
  assert.equal(checkSafetyRetry(root, activeCommand, report.limits).ok, true);

  const capacityRoot = path.join(root, 'retry-capacity-root');
  fs.mkdirSync(capacityRoot);
  const capacityCommand = [process.execPath, path.join(capacityRoot, 'workload.mjs')];
  fs.writeFileSync(capacityCommand[1], 'process.exit(0);\n');
  const ledgerRoot = path.join(process.env.LAMINA_SAFE_RUNNER_STATE_DIR, 'safety-limit-ledger');
  const repositoriesBefore = new Set(fs.readdirSync(ledgerRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  recordSafetyLimit(capacityRoot, capacityCommand, report.limits, {
    ...limitedReport, run_id: 'capacity-first', command: capacityCommand,
  });
  const capacityRepositoryName = fs.readdirSync(ledgerRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && !repositoriesBefore.has(entry.name))?.name;
  const capacityRepository = path.join(ledgerRoot, capacityRepositoryName);
  const capacityShard = fs.readdirSync(capacityRepository, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))?.name;
  const capacityShardPath = path.join(capacityRepository, capacityShard);
  for (let index = 0; index < 63; index += 1) {
    const name = crypto.createHash('sha256').update(`capacity-${index}`).digest('hex');
    fs.writeFileSync(path.join(capacityShardPath, `${name}.json`), '{}\n');
  }
  recordSafetyLimit(capacityRoot, capacityCommand, report.limits, {
    ...limitedReport, run_id: 'capacity-overflow', command: capacityCommand,
  });
  const saturatedRetry = checkSafetyRetry(capacityRoot, capacityCommand, report.limits);
  assert.equal(saturatedRetry.previous.limit, 'retry_ledger_saturated');
  assert.deepEqual(fs.readdirSync(capacityShardPath), ['saturated.json'],
    'a saturated command shard must compact to one fail-closed marker');

  const repositoryCapacityRoot = path.join(root, 'retry-repository-capacity-root');
  fs.mkdirSync(repositoryCapacityRoot);
  const repositoryCapacityCommand = [process.execPath, '-e', 'repository-capacity-first'];
  const repositoriesBeforeGlobal = new Set(fs.readdirSync(ledgerRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  recordSafetyLimit(repositoryCapacityRoot, repositoryCapacityCommand, report.limits, {
    ...limitedReport, run_id: 'repository-capacity-first', command: repositoryCapacityCommand,
  });
  const repositoryCapacityName = fs.readdirSync(ledgerRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && !repositoriesBeforeGlobal.has(entry.name))?.name;
  const repositoryCapacityPath = path.join(ledgerRoot, repositoryCapacityName);
  let shardCount = fs.readdirSync(repositoryCapacityPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)).length;
  for (let index = 0; shardCount < 255; index += 1, shardCount += 1) {
    const name = crypto.createHash('sha256').update(`repository-capacity-${index}`).digest('hex');
    fs.mkdirSync(path.join(repositoryCapacityPath, name));
  }
  const capacityIds = Array.from({ length: 12 }, (_, index) => `repository-overflow-${index}`);
  const capacityStatuses = await Promise.all(capacityIds.map(async (id) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', concurrentWriter], {
      stdio: 'ignore',
      env: {
        ...process.env,
        LAMINA_LEDGER_WRITER_ID: id,
        LAMINA_LEDGER_WRITER_CWD: repositoryCapacityRoot,
      },
    });
    return (await once(child, 'exit'))[0];
  }));
  assert.deepEqual(capacityStatuses, capacityStatuses.map(() => 0));
  const boundedRepositoryEntries = fs.readdirSync(repositoryCapacityPath, { withFileTypes: true });
  assert.equal(
    boundedRepositoryEntries.filter((entry) => entry.isDirectory()
      && /^[a-f0-9]{64}$/.test(entry.name)).length,
    256,
    'concurrent command writers must not exceed the repository shard bound',
  );
  assert.equal(boundedRepositoryEntries.some((entry) => entry.name === 'saturated.json'), true);
  const blockedCapacityCommand = [process.execPath, '-e', capacityIds.at(-1)];
  assert.equal(
    checkSafetyRetry(repositoryCapacityRoot, blockedCapacityCommand, report.limits).previous.limit,
    'retry_ledger_saturated',
  );

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
    tier: 'medium', command: ['node', '-e', ''], cwd: promotionRoot,
    adapterInfo: productionProbe, injectedExistingProcesses: [],
  });
  assert.equal(unpromoted.ok, false);
  assert.match(unpromoted.reasons.join('\n'), /tier promotion requires successful cleanup for: small/);

  const repositoriesBeforeRead = fs.readdirSync(ledgerRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{24}$/.test(entry.name)).length;
  const readOnlyRetryRoot = path.join(root, 'read-only-retry-root');
  fs.mkdirSync(readOnlyRetryRoot);
  assert.equal(checkSafetyRetry(readOnlyRetryRoot, ['node', '-e', 'read-only'], {}).ok, true);
  assert.equal(
    fs.readdirSync(ledgerRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[a-f0-9]{24}$/.test(entry.name)).length,
    repositoriesBeforeRead,
    'a retry check without a fence must not consume repository capacity',
  );

  let retryRepositoryCount = repositoriesBeforeRead;
  for (let index = 0; retryRepositoryCount < 256; index += 1) {
    const name = crypto.createHash('sha256').update(`global-repository-${index}`).digest('hex').slice(0, 24);
    const directory = path.join(ledgerRoot, name);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory);
      retryRepositoryCount += 1;
    }
  }
  const globallyBlockedRoot = path.join(root, 'globally-blocked-retry-root');
  fs.mkdirSync(globallyBlockedRoot);
  const globallyBlockedCommand = [process.execPath, '-e', 'globally-blocked'];
  const globalSaturation = recordSafetyLimit(
    globallyBlockedRoot, globallyBlockedCommand, {},
    { ...limitedReport, run_id: 'globally-blocked', command: globallyBlockedCommand },
  );
  assert.equal(globalSaturation.reason, 'global_repository_capacity');
  assert.equal(checkSafetyRetry(globallyBlockedRoot, globallyBlockedCommand, {}).ok, false);
  assert.equal(fs.existsSync(path.join(ledgerRoot, 'saturated.json')), true);

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
  assert.match(readme, /npm run safe:envelope/);
  assert.match(guide, /--tier small[\s\S]*--report[\s\S]*--promote/);
  assert.match(guide, /There is no unrestricted fallback/);
  assert.match(adr, /# ADR-014:[\s\S]*## Decision[\s\S]*systemd scope/);
  assert.match(workflow, /ubuntu-22\.04[\s\S]*bubblewrap_0\.8\.0-2\+deb12u1_amd64\.deb[\s\S]*3cc9134a3286ad01a323dcd924ba123eb634cefaeec82d774257e06308aeaadb[\s\S]*verify-qualification-result\.mjs/);
  assert.match(workflow, /test:safe-runner/);
  assert.doesNotMatch(workflow, /\bsudo\b/);

  process.stdout.write('safe-runner unit contracts passed\n');
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
}
