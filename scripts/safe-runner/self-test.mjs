import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { adapterProbe } from './adapter.mjs';
import { MIB, SELF_TEST_CASE_IDS } from './constants.mjs';
import { runSafely } from './runner.mjs';
import { systemdAbsenceProof } from './linux-systemd.mjs';
import { baseReport, finishReport, validateReport, writeReport } from './report.mjs';
import { redactText } from './redaction.mjs';
import { acquireConcurrencyLock, stateDirectory, writeAttestation } from './state.mjs';
import { infrastructureBinaries, sanitizedEnvironment } from './infrastructure.mjs';
import { lstatPresence } from './managed-paths.mjs';
import { identityAlive, processIdentity } from './processes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, '../../tests/fixtures/safe-runner-adversary.mjs');
const CONTROLLER_FIXTURE = path.resolve(HERE, '../../tests/fixtures/safe-runner-controller.mjs');
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
export const SUPERVISOR_CRASH_PREPARATION_TIMEOUT_MS = 30_000;
export const SUPERVISOR_CRASH_REPORT_TIMEOUT_MS = 10_000;

function boundedTestTimeout(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 && value <= 60_000 ? value : fallback;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function cleanupVerified(report) {
  return report.cleanup.descendants_remaining.length === 0
    && report.cleanup.scope_removed === true
    && report.cleanup.temporary_directory_removed === true
    && report.cleanup.errors.length === 0;
}

function expected(report, outcome, limits = []) {
  return report.outcome === outcome
    && (limits.length === 0 || limits.includes(report.termination.limit))
    && cleanupVerified(report);
}

export function boundedCaseError(error) {
  if (!error) return null;
  return {
    code: redactText(String(error.code || 'LAMINA_SAFE_INTERNAL')).slice(0, 128),
    message: redactText(String(error.message || error)).slice(0, 500),
  };
}

export async function runSupervisorCrashSelfTest({
  cwd, reportDirectory, boundary = 'payload_released', graphRepository = null,
  previousReport = null,
  _testControllerFixture = CONTROLLER_FIXTURE,
  _testControllerArguments = [],
  _testPreparationTimeoutMs = SUPERVISOR_CRASH_PREPARATION_TIMEOUT_MS,
  _testReportTimeoutMs = SUPERVISOR_CRASH_REPORT_TIMEOUT_MS,
}) {
  const preparationTimeoutMs = boundedTestTimeout(
    _testPreparationTimeoutMs, SUPERVISOR_CRASH_PREPARATION_TIMEOUT_MS,
  );
  const reportTimeoutMs = boundedTestTimeout(
    _testReportTimeoutMs, SUPERVISOR_CRASH_REPORT_TIMEOUT_MS,
  );
  const safeBoundary = boundary.replace(/[^a-z0-9_-]/gi, '-');
  const crashReportPath = path.join(reportDirectory, `parent_signal_sigkill_${safeBoundary}.json`);
  const armedFile = `${crashReportPath}.crash-boundary`;
  const progressFile = `${crashReportPath}.crash-progress`;
  fs.rmSync(crashReportPath, { force: true });
  fs.rmSync(armedFile, { force: true });
  fs.rmSync(progressFile, { force: true });
  if (previousReport) fs.writeFileSync(crashReportPath, `${JSON.stringify(previousReport)}\n`);
  const controller = spawn(process.execPath, [
    _testControllerFixture, cwd, crashReportPath, boundary, graphRepository || '', progressFile,
    ..._testControllerArguments.map(String),
  ], {
    cwd, env: sanitizedEnvironment(process.env), stdio: 'ignore',
  });
  let controllerIdentity = null;
  const identityDeadline = Date.now() + 250;
  while (Date.now() < identityDeadline && !controllerIdentity
    && controller.exitCode === null && controller.signalCode === null) {
    controllerIdentity = processIdentity(controller.pid);
    if (!controllerIdentity) await wait(10);
  }
  if (!controllerIdentity) {
    const controllerExit = controller.exitCode !== null || controller.signalCode !== null
      ? Promise.resolve(true) : once(controller, 'exit').then(() => true);
    controller.kill('SIGKILL');
    const exited = await Promise.race([controllerExit, wait(reportTimeoutMs).then(() => false)]);
    if (!exited) {
      const cleanupError = new Error('could not prove cleanup of unidentified self-test controller');
      cleanupError.code = 'LAMINA_SAFE_SELF_TEST_CONTROLLER_CLEANUP_UNPROVEN';
      throw cleanupError;
    }
    throw new Error('could not establish exact self-test controller identity');
  }
  let armed = null;
  let progress = null;
  const preparationStartedMs = Date.now();
  const armedDeadline = preparationStartedMs + preparationTimeoutMs;
  while (Date.now() < armedDeadline
    && controller.exitCode === null && controller.signalCode === null) {
    try { progress = JSON.parse(fs.readFileSync(progressFile, 'utf8')); } catch {}
    try { armed = JSON.parse(fs.readFileSync(armedFile, 'utf8')); break; } catch {}
    await wait(20);
  }
  const boundaryReached = armed?.controller_pid === controller.pid
    && (typeof armed.unit === 'string' || boundary === 'report_slot_acquired');
  const diagnostic = boundaryReached ? null : {
    code: 'boundary_not_reached',
    boundary,
    preparation_timeout_ms: preparationTimeoutMs,
    waited_ms: Math.max(0, Date.now() - preparationStartedMs),
    marker_observed: armed !== null,
    controller_exit_code: controller.exitCode,
    controller_signal: controller.signalCode,
  };
  let crashReport = null;
  const evidence = {
    controller_dead: false, scope_absent: false, temporary_removed: false,
    watchdog_state_removed: false, lock_removed: false, subsequent_claim: false,
    descendants_absent: false, managed_paths_absent: false, schema_valid: false,
  };
  const controllerExit = controller.exitCode !== null || controller.signalCode !== null
    ? Promise.resolve() : once(controller, 'exit');
  if (controller.exitCode === null && controller.signalCode === null) controller.kill('SIGKILL');
  await Promise.race([controllerExit, wait(reportTimeoutMs)]);
  const controllerCleanupDeadline = Date.now() + reportTimeoutMs;
  while (Date.now() < controllerCleanupDeadline && identityAlive(controllerIdentity)) {
    try { controller.kill('SIGKILL'); } catch {}
    await wait(20);
  }
  if (identityAlive(controllerIdentity)) {
    throw new Error('exact self-test controller identity remained alive after forced cleanup');
  }
  evidence.controller_dead = true;
  if (!progress) {
    try { progress = JSON.parse(fs.readFileSync(progressFile, 'utf8')); } catch {}
  }
  const resourceState = boundaryReached ? armed : progress;
  const validResourceState = resourceState?.controller_pid === controller.pid
    && Number.isSafeInteger(resourceState?.watchdog_process?.pid)
    && typeof resourceState?.watchdog_process?.start_ticks === 'string'
    && typeof resourceState?.unit === 'string';
  const ownedStateRemoved = () => boundary === 'report_slot_acquired'
    || (validResourceState
      && !identityAlive(resourceState.watchdog_process)
      && (resourceState.temporary_directory === null
        || (typeof resourceState.temporary_directory === 'string'
          && !fs.existsSync(resourceState.temporary_directory)))
      && (typeof resourceState.watchdog_directory === 'string'
        && !fs.existsSync(resourceState.watchdog_directory))
      && (resourceState.lock_file === null
        || (typeof resourceState.lock_file === 'string'
          && !lstatPresence(resourceState.lock_file).exists)));
  const authoritativeCleanupProven = () => {
    const cleanup = crashReport?.cleanup;
    return crashReport?.error?.code === 'LAMINA_SAFE_SUPERVISOR_CRASH'
      && validateReport(crashReport).valid
      && cleanup?.attempted === true
      && cleanup?.descendants_remaining?.length === 0
      && cleanup?.managed_paths_remaining?.length === 0
      && cleanup?.scope_removed === true
      && cleanup?.temporary_directory_removed === true
      && cleanup?.lock_released === true
      && cleanup?.errors?.length === 0;
  };
  const reportDeadline = Date.now()
    + (boundaryReached && boundary === 'report_slot_acquired' ? 250 : reportTimeoutMs);
  while (Date.now() < reportDeadline) {
    try {
      const candidate = JSON.parse(fs.readFileSync(crashReportPath, 'utf8'));
      if ((boundaryReached && boundary === 'report_slot_acquired')
        || candidate?.error?.code === 'LAMINA_SAFE_SUPERVISOR_CRASH'
        || candidate?.error?.code === 'LAMINA_SAFE_CLEANUP_INCOMPLETE') {
        crashReport = candidate;
      }
    } catch {}
    const preparationReportReady = boundaryReached && boundary === 'report_slot_acquired'
      && crashReport !== null;
    if (preparationReportReady
      || (crashReport && ownedStateRemoved() && authoritativeCleanupProven())) break;
    await wait(20);
  }
  if (boundaryReached || validResourceState) {
    const shown = boundary === 'report_slot_acquired' ? null
      : spawnSync(infrastructureBinaries().systemctl, [
        '--user', 'show', resourceState.unit, '--property=LoadState', '--property=ControlGroup',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000,
        env: sanitizedEnvironment(process.env) });
    try {
      const claim = acquireConcurrencyLock({
        scope: {
          adapter: 'linux-systemd-cgroup-v2',
          unit: 'lamina-safe-post-crash-proof.scope',
          cgroup: null,
        },
      });
      evidence.subsequent_claim = claim.release() === true;
    } catch {}
    evidence.scope_absent = boundary === 'report_slot_acquired' || systemdAbsenceProof(shown, false);
    evidence.temporary_removed = boundary === 'report_slot_acquired'
      || (resourceState.temporary_directory === null
        || (typeof resourceState.temporary_directory === 'string'
          && !fs.existsSync(resourceState.temporary_directory)));
    evidence.watchdog_state_removed = boundary === 'report_slot_acquired'
      || (typeof resourceState.watchdog_directory === 'string'
        && !fs.existsSync(resourceState.watchdog_directory)
        && !identityAlive(resourceState.watchdog_process));
    evidence.lock_removed = boundary === 'report_slot_acquired'
      || resourceState.lock_file === null
      || (typeof resourceState.lock_file === 'string'
        && !lstatPresence(resourceState.lock_file).exists);
    evidence.descendants_absent = boundary === 'report_slot_acquired'
      || crashReport?.cleanup?.descendants_remaining?.length === 0;
    evidence.managed_paths_absent = boundary === 'report_slot_acquired'
      || crashReport?.cleanup?.managed_paths_remaining?.length === 0;
    evidence.schema_valid = validateReport(crashReport || {}).valid;
  }
  if (diagnostic) {
    diagnostic.report_observed = crashReport !== null;
    diagnostic.authoritative_cleanup_proven = authoritativeCleanupProven();
    diagnostic.exact_cleanup_proven = ownedStateRemoved()
      && authoritativeCleanupProven()
      && evidence.scope_absent
      && evidence.temporary_removed
      && evidence.watchdog_state_removed
      && evidence.lock_removed
      && evidence.subsequent_claim
      && evidence.descendants_absent
      && evidence.managed_paths_absent
      && evidence.schema_valid;
    if (!diagnostic.exact_cleanup_proven) {
      const error = new Error('boundary was not reached and exact watchdog cleanup was not proven');
      error.code = 'LAMINA_SAFE_SELF_TEST_CLEANUP_UNPROVEN';
      error.diagnostic = diagnostic;
      throw error;
    }
  }
  fs.rmSync(armedFile, { force: true });
  fs.rmSync(progressFile, { force: true });
  const earlyPreparationPassed = boundary === 'report_slot_acquired'
    && crashReport?.outcome === 'internal_error'
    && crashReport?.termination?.reason === 'run_in_progress'
    && crashReport?.error?.code === 'LAMINA_SAFE_RUN_IN_PROGRESS'
    && Object.values(evidence).every(Boolean);
  const snapshotPreparationPassed = ['snapshot_building', 'before_payload_release'].includes(boundary)
    && crashReport?.outcome === 'internal_error'
    && crashReport?.termination?.reason === 'supervisor_crash_before_payload'
    && crashReport?.error?.code === 'LAMINA_SAFE_SUPERVISOR_CRASH'
    && crashReport?.cleanup?.scope_removed === true
    && crashReport?.cleanup?.temporary_directory_removed === true
    && crashReport?.cleanup?.errors?.length === 0
    && crashReport?.cleanup?.lock_released === true
    && Object.values(evidence).every(Boolean);
  const bootstrapPreparationPassed = [
    'watchdog_state_created', 'runner_temporary_created',
  ].includes(boundary)
    && crashReport?.outcome === 'internal_error'
    && crashReport?.termination?.reason === 'supervisor_crash_before_payload'
    && crashReport?.error?.code === 'LAMINA_SAFE_SUPERVISOR_CRASH'
    && crashReport?.cleanup?.scope_removed === true
    && crashReport?.cleanup?.temporary_directory_removed === true
    && crashReport?.cleanup?.lock_released === true
    && crashReport?.cleanup?.errors?.length === 0
    && Object.values(evidence).every(Boolean);
  const passed = boundaryReached && (earlyPreparationPassed || bootstrapPreparationPassed
    || snapshotPreparationPassed || (crashReport?.outcome === 'interrupted'
    && crashReport?.error?.code === 'LAMINA_SAFE_SUPERVISOR_CRASH'
    && crashReport?.cleanup?.scope_removed === true
    && crashReport?.cleanup?.temporary_directory_removed === true
    && crashReport?.cleanup?.descendants_remaining?.length === 0
    && crashReport?.cleanup?.errors?.length === 0
    && crashReport?.cleanup?.lock_released === true
    && crashReport?.termination?.requested_signals?.includes('SIGKILL')
    && Object.values(evidence).every(Boolean)));
  return { passed, report: crashReport, report_path: crashReportPath, evidence, diagnostic };
}

export async function runHandledParentSignalSelfTest({
  cwd,
  reportDirectory,
  _testControllerFixture = CONTROLLER_FIXTURE,
  _testControllerArguments = [],
  _testPreparationTimeoutMs = SUPERVISOR_CRASH_PREPARATION_TIMEOUT_MS,
  _testReportTimeoutMs = SUPERVISOR_CRASH_REPORT_TIMEOUT_MS,
}) {
  const preparationTimeoutMs = boundedTestTimeout(
    _testPreparationTimeoutMs, SUPERVISOR_CRASH_PREPARATION_TIMEOUT_MS,
  );
  const reportTimeoutMs = boundedTestTimeout(
    _testReportTimeoutMs, SUPERVISOR_CRASH_REPORT_TIMEOUT_MS,
  );
  const reportPath = path.join(reportDirectory, 'parent_signal_host_sigint.json');
  const armedFile = `${reportPath}.crash-boundary`;
  const progressFile = `${reportPath}.crash-progress`;
  fs.rmSync(reportPath, { force: true });
  fs.rmSync(armedFile, { force: true });
  fs.rmSync(progressFile, { force: true });
  const controller = spawn(process.execPath, [
    _testControllerFixture, cwd, reportPath, 'payload_released', '', progressFile,
    ..._testControllerArguments.map(String),
  ], {
    cwd, env: sanitizedEnvironment(process.env), stdio: 'ignore',
  });
  let controllerIdentity = null;
  const identityDeadline = Date.now() + 250;
  while (Date.now() < identityDeadline && !controllerIdentity
    && controller.exitCode === null && controller.signalCode === null) {
    controllerIdentity = processIdentity(controller.pid);
    if (!controllerIdentity) await wait(10);
  }
  if (!controllerIdentity) {
    const controllerExit = controller.exitCode !== null || controller.signalCode !== null
      ? Promise.resolve(true) : once(controller, 'exit').then(() => true);
    controller.kill('SIGKILL');
    const exited = await Promise.race([controllerExit, wait(reportTimeoutMs).then(() => false)]);
    if (!exited) {
      const cleanupError = new Error('could not prove cleanup of unidentified SIGINT self-test controller');
      cleanupError.code = 'LAMINA_SAFE_SELF_TEST_CONTROLLER_CLEANUP_UNPROVEN';
      throw cleanupError;
    }
    throw new Error('could not establish exact SIGINT self-test controller identity');
  }
  let armed = null;
  let progress = null;
  const preparationStartedMs = Date.now();
  const deadline = preparationStartedMs + preparationTimeoutMs;
  while (Date.now() < deadline
    && controller.exitCode === null && controller.signalCode === null) {
    try { progress = JSON.parse(fs.readFileSync(progressFile, 'utf8')); } catch {}
    try { armed = JSON.parse(fs.readFileSync(armedFile, 'utf8')); break; } catch {}
    await wait(20);
  }
  const boundaryReached = armed?.boundary === 'payload_released'
    && armed?.controller_pid === controller.pid
    && typeof armed?.unit === 'string'
    && Number.isSafeInteger(armed?.watchdog_process?.pid)
    && typeof armed?.watchdog_process?.start_ticks === 'string';
  const diagnostic = boundaryReached ? null : {
    code: 'boundary_not_reached',
    boundary: 'payload_released',
    preparation_timeout_ms: preparationTimeoutMs,
    waited_ms: Math.max(0, Date.now() - preparationStartedMs),
    marker_observed: armed !== null,
    controller_exit_code: controller.exitCode,
    controller_signal: controller.signalCode,
  };
  let sigintRequested = false;
  if (controller.exitCode === null && controller.signalCode === null) {
    if (boundaryReached) sigintRequested = controller.kill('SIGINT') === true;
    else controller.kill('SIGKILL');
  }
  if (!progress) {
    try { progress = JSON.parse(fs.readFileSync(progressFile, 'utf8')); } catch {}
  }
  const resourceState = boundaryReached ? armed : progress;
  const validResourceState = resourceState?.controller_pid === controller.pid
    && typeof resourceState?.unit === 'string'
    && Number.isSafeInteger(resourceState?.watchdog_process?.pid)
    && typeof resourceState?.watchdog_process?.start_ticks === 'string';
  let report = null;
  let scopeAbsent = false;
  const ownedStateRemoved = () => validResourceState
    && !identityAlive(resourceState.watchdog_process)
    && (resourceState.temporary_directory === null
      || (typeof resourceState.temporary_directory === 'string'
        && !fs.existsSync(resourceState.temporary_directory)))
    && typeof resourceState.watchdog_directory === 'string'
    && !fs.existsSync(resourceState.watchdog_directory)
    && (resourceState.lock_file === null
      || (typeof resourceState.lock_file === 'string'
        && !lstatPresence(resourceState.lock_file).exists));
  const completeCleanupReport = () => {
    const cleanup = report?.cleanup;
    return validateReport(report || {}).valid
      && cleanup?.attempted === true
      && cleanup?.descendants_remaining?.length === 0
      && cleanup?.managed_paths_remaining?.length === 0
      && cleanup?.scope_removed === true
      && cleanup?.temporary_directory_removed === true
      && cleanup?.lock_released === true
      && cleanup?.errors?.length === 0;
  };
  const refreshReport = () => {
    try {
      const candidate = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (candidate?.error?.code !== 'LAMINA_SAFE_RUN_IN_PROGRESS') report = candidate;
    } catch {}
  };
  const refreshScopeAbsence = () => {
    if (scopeAbsent || !validResourceState) return;
    const shown = spawnSync(infrastructureBinaries().systemctl, [
      '--user', 'show', resourceState.unit, '--property=LoadState', '--property=ControlGroup',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000,
      env: sanitizedEnvironment(process.env) });
    scopeAbsent = systemdAbsenceProof(shown, false);
  };
  const cleanupProven = () => !identityAlive(controllerIdentity)
    && ownedStateRemoved() && completeCleanupReport() && scopeAbsent;
  let reportDeadline = Date.now() + reportTimeoutMs;
  while (Date.now() < reportDeadline) {
    refreshReport();
    if (!identityAlive(controllerIdentity) && ownedStateRemoved() && completeCleanupReport()) {
      refreshScopeAbsence();
    }
    if (cleanupProven()) break;
    await wait(20);
  }
  let handledTimeout = false;
  if (!cleanupProven() && identityAlive(controllerIdentity)) {
    handledTimeout = boundaryReached;
    try { controller.kill('SIGKILL'); } catch {}
    reportDeadline = Date.now() + reportTimeoutMs;
    while (Date.now() < reportDeadline) {
      refreshReport();
      if (!identityAlive(controllerIdentity) && ownedStateRemoved() && completeCleanupReport()) {
        refreshScopeAbsence();
      }
      if (cleanupProven()) break;
      await wait(20);
    }
  }
  let subsequentClaim = false;
  if (cleanupProven()) {
    try {
      const claim = acquireConcurrencyLock({
        scope: {
          adapter: 'linux-systemd-cgroup-v2',
          unit: 'lamina-safe-post-sigint-proof.scope',
          cgroup: null,
        },
      });
      subsequentClaim = claim.release() === true;
    } catch {}
  }
  const exactCleanupProven = cleanupProven() && subsequentClaim;
  if (!exactCleanupProven) {
    const error = new Error('handled SIGINT self-test exact cleanup was not proven');
    error.code = 'LAMINA_SAFE_SELF_TEST_CLEANUP_UNPROVEN';
    error.diagnostic = {
      ...(diagnostic || { code: 'handled_signal_cleanup_unproven', boundary: 'payload_released' }),
      report_observed: report !== null,
      controller_removed: !identityAlive(controllerIdentity),
      watchdog_state_removed: ownedStateRemoved(),
      scope_absent: scopeAbsent,
      authoritative_cleanup_proven: completeCleanupReport(),
      subsequent_claim: subsequentClaim,
      exact_cleanup_proven: false,
    };
    throw error;
  }
  fs.rmSync(armedFile, { force: true });
  fs.rmSync(progressFile, { force: true });
  const passed = report?.outcome === 'interrupted'
    && report?.termination?.reason === 'interrupted'
    && report?.termination?.limit === 'signal'
    && report?.error?.code === 'LAMINA_SAFE_INTERRUPTED'
    && report?.cleanup?.scope_removed === true
    && report?.cleanup?.temporary_directory_removed === true
    && report?.cleanup?.errors?.length === 0
    && validateReport(report).valid
    && boundaryReached
    && sigintRequested
    && !handledTimeout;
  const signalDiagnostic = boundaryReached && !sigintRequested ? {
    code: 'handled_signal_not_delivered',
    boundary: 'payload_released',
  } : null;
  const resultDiagnostic = diagnostic || signalDiagnostic || (handledTimeout ? {
    code: 'handled_signal_cleanup_timeout',
    boundary: 'payload_released',
    exact_cleanup_proven: true,
  } : null);
  if (resultDiagnostic) {
    resultDiagnostic.report_observed = report !== null;
    resultDiagnostic.authoritative_cleanup_proven = completeCleanupReport();
    resultDiagnostic.scope_absent = scopeAbsent;
    resultDiagnostic.subsequent_claim = subsequentClaim;
    resultDiagnostic.exact_cleanup_proven = true;
  }
  return {
    passed,
    report,
    report_path: reportPath,
    signal_requested: sigintRequested,
    diagnostic: resultDiagnostic,
    evidence: {
      controller_dead: true,
      scope_absent: scopeAbsent,
      temporary_removed: resourceState.temporary_directory === null
        || !fs.existsSync(resourceState.temporary_directory),
      watchdog_state_removed: !identityAlive(resourceState.watchdog_process)
        && !fs.existsSync(resourceState.watchdog_directory),
      lock_removed: resourceState.lock_file === null
        || !lstatPresence(resourceState.lock_file).exists,
      subsequent_claim: subsequentClaim,
      descendants_absent: report.cleanup.descendants_remaining.length === 0,
      managed_paths_absent: report.cleanup.managed_paths_remaining.length === 0,
      schema_valid: validateReport(report).valid,
    },
  };
}

export async function runAdversarialSelfTests({ cwd = process.cwd(), probe = adapterProbe() } = {}) {
  const reportDirectory = path.join(stateDirectory(), 'self-tests');
  fs.mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });

  // A portable process group cannot prove ownership of a child that creates a
  // new session. Refuse host qualification before launching an adversarial
  // matrix that could leave such a child behind. Individual, deliberately
  // tiny portable fixtures remain allowlisted for focused contract tests.
  if (!probe.production_enforcement) {
    const refusal = {
      code: 'LAMINA_SAFE_PRODUCTION_ENFORCEMENT_REQUIRED',
      message: [
        'full adversarial host qualification requires Linux user-systemd cgroup-v2 enforcement',
        ...(probe.reasons || []),
      ].join('; '),
    };
    const cases = SELF_TEST_CASE_IDS.map((id) => ({
      id,
      passed: false,
      skipped: true,
      outcome: 'preflight_refused',
      cleanup_verified: true,
      error: boundedCaseError(refusal),
      report_digest: digest({ id, refusal }),
      report: null,
    }));
    const attestation = writeAttestation(probe, cases);
    return {
      schema: 'lamina.safe-runner-self-test/v1',
      passed: false,
      qualified_for_production_tiers: false,
      adapter: probe,
      refusal,
      attestation,
      cases,
    };
  }

  const cases = [];
  const baseOverrides = {
    memoryMaxBytes: 192 * MIB,
    memoryHighBytes: 160 * MIB,
    pidsMax: 32,
    timeoutMs: 2_000,
    outputMaxBytes: 256 * 1024,
    tempMaxBytes: 4 * MIB,
    sampleIntervalMs: 25,
    sustainedHighSamples: 2,
    gracefulStopMs: 100,
  };

  const runCase = async ({ id, fixtureMode, outcome, limits = [], overrides = {}, verify = () => true }) => {
    const reportPath = path.join(reportDirectory, `${id}.json`);
    const report = await runSafely({
      command: [process.execPath, FIXTURE, fixtureMode],
      tier: 'small',
      cwd,
      reportFile: reportPath,
      overrides: { ...baseOverrides, ...overrides },
      probe,
      mode: 'self-test',
      selfTestCaseId: id,
      promote: false,
    });
    const record = {
      id,
      passed: report.preflight?.deliberately_tiny_self_test === true
        && expected(report, outcome, limits) && verify(report),
      outcome: report.outcome,
      termination_reason: report.termination.reason,
      limit: report.termination.limit,
      peak_rss_bytes: report.peaks.aggregate_rss_bytes,
      peak_pids: report.peaks.pids,
      requested_signals: report.termination.requested_signals,
      cleanup_verified: cleanupVerified(report),
      error: boundedCaseError(report.error),
      report_digest: digest(report),
      report: report.report_file,
    };
    cases.push(record);
  };

  await runCase({
    id: 'normal_cleanup',
    fixtureMode: 'scope-escape',
    outcome: 'success',
    verify: (report) => {
      let evidence = null;
      try { evidence = JSON.parse(report.output.stdout_tail.trim().split('\n').at(-1)); } catch {}
      const shown = spawnSync(infrastructureBinaries().systemctl, [
        '--user', 'show', evidence?.unit || 'lamina-safe-invalid-escape-proof.scope',
        '--property=LoadState', '--property=ControlGroup',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000,
        env: sanitizedEnvironment(process.env) });
      return evidence?.scope_escape_refused === true
        && systemdAbsenceProof(shown, false);
    },
  });
  await runCase({
    id: 'direct_memory_limit',
    fixtureMode: 'direct-memory',
    outcome: 'safety_limit_exceeded',
    limits: ['memory', 'sustained_high_memory'],
    overrides: { memoryMaxBytes: 112 * MIB, memoryHighBytes: 88 * MIB },
  });
  await runCase({
    id: 'aggregate_child_memory_limit',
    fixtureMode: 'aggregate-memory',
    outcome: 'safety_limit_exceeded',
    limits: ['memory', 'sustained_high_memory'],
    overrides: { memoryMaxBytes: 192 * MIB, memoryHighBytes: 152 * MIB },
    verify: (report) => report.peaks.pids >= 3,
  });
  await runCase({
    id: 'ignored_graceful_termination',
    fixtureMode: 'ignore-term',
    outcome: 'safety_limit_exceeded',
    limits: ['timeout'],
    overrides: { timeoutMs: 300, gracefulStopMs: 75 },
    verify: (report) => report.termination.requested_signals.includes('SIGKILL'),
  });
  await runCase({
    id: 'timeout_hang', fixtureMode: 'hang', outcome: 'safety_limit_exceeded', limits: ['timeout'],
    overrides: { timeoutMs: 300 },
  });
  await runCase({
    id: 'rapid_process_spawning', fixtureMode: 'spawn-storm', outcome: 'safety_limit_exceeded', limits: ['pids'],
    overrides: { pidsMax: 24, timeoutMs: 1_500 },
  });
  await runCase({
    id: 'stdout_stderr_flood', fixtureMode: 'output-flood', outcome: 'safety_limit_exceeded', limits: ['output'],
    overrides: { outputMaxBytes: 64 * 1024 },
  });
  await runCase({
    id: 'runner_temporary_disk_growth', fixtureMode: 'temp-growth', outcome: 'safety_limit_exceeded', limits: ['temporary_disk'],
    overrides: { tempMaxBytes: 1 * MIB },
  });
  const handled = await runHandledParentSignalSelfTest({ cwd, reportDirectory });
  const parentSignalRecord = {
    id: 'parent_signal',
    passed: handled.passed,
    outcome: handled.report?.outcome || 'missing',
    termination_reason: handled.report?.termination?.reason || null,
    limit: handled.report?.termination?.limit || null,
    peak_rss_bytes: handled.report?.peaks?.aggregate_rss_bytes || 0,
    peak_pids: handled.report?.peaks?.pids || 0,
    requested_signals: handled.report?.termination?.requested_signals || [],
    cleanup_verified: handled.passed,
    error: boundedCaseError(handled.report?.error),
    report_digest: digest(handled.report),
    report: handled.report_path,
    handled_host_sigint: {
      passed: handled.passed,
      report: handled.report_path,
      signal_requested: handled.signal_requested,
      evidence: handled.evidence,
      diagnostic: handled.diagnostic,
    },
  };
  cases.push(parentSignalRecord);
  const crash = await runSupervisorCrashSelfTest({ cwd, reportDirectory });
  parentSignalRecord.passed = parentSignalRecord.passed && crash.passed;
  parentSignalRecord.cleanup_verified = parentSignalRecord.cleanup_verified && crash.passed;
  parentSignalRecord.supervisor_sigkill = {
    passed: crash.passed,
    outcome: crash.report?.outcome || 'missing',
    cleanup_verified: crash.passed,
    report: crash.report_path,
    evidence: crash.evidence,
  };
  parentSignalRecord.report_digest = digest({
    handled_signal_report: parentSignalRecord.report_digest,
    supervisor_sigkill_report: crash.report,
  });

  const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  const staleDirectory = path.join(reportDirectory, 'stale-lock-state');
  const claims = path.join(staleDirectory, 'production-locks');
  fs.mkdirSync(claims, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(claims, 'stale.json'), JSON.stringify({
    pid: process.pid,
    start_ticks: 'stale-identity-that-cannot-match',
    nonce: 'stale',
    scope: {
      adapter: 'linux-systemd-cgroup-v2',
      unit: 'lamina-safe-stale-self-test.scope',
      cgroup: null,
    },
  }), { mode: 0o600 });
  process.env.LAMINA_SAFE_RUNNER_STATE_DIR = staleDirectory;
  let stalePassed = false;
  try {
    const lock = acquireConcurrencyLock({ directory: claims });
    stalePassed = lock.release() === true
      && fs.readdirSync(claims).filter((name) => name.endsWith('.json')).length === 0;
  } finally {
    if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
    else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  }
  const staleReportPath = path.join(reportDirectory, 'stale_process_record.json');
  const staleReport = baseReport({
    tier: 'small', command: ['internal:stale-process-record'], cwd,
  });
  staleReport.report_file = staleReportPath;
  staleReport.outcome = stalePassed ? 'preflight_refused' : 'internal_error';
  staleReport.adapter = probe;
  staleReport.preflight = {
    ok: false,
    deliberately_tiny_self_test: true,
    reasons: ['internal stale process identity exercise; no payload launched'],
  };
  staleReport.termination.reason = stalePassed ? 'preflight_refused' : 'cleanup_incomplete';
  staleReport.cleanup = {
    attempted: true,
    descendants_remaining: [],
    managed_paths_remaining: [],
    scope_removed: true,
    temporary_directory_removed: true,
    lock_released: stalePassed,
    errors: stalePassed ? [] : ['stale concurrency claim was not safely replaced and released'],
  };
  staleReport.error = stalePassed ? null : {
    code: 'LAMINA_SAFE_STALE_LOCK', message: staleReport.cleanup.errors[0],
  };
  finishReport(staleReport, Date.now());
  writeReport(staleReportPath, staleReport);
  cases.push({
    id: 'stale_process_record',
    passed: stalePassed,
    outcome: staleReport.outcome,
    cleanup_verified: stalePassed,
    error: boundedCaseError(staleReport.error),
    report_digest: digest(staleReport),
    report: staleReportPath,
  });

  await runCase({
    id: 'detached_descendant',
    fixtureMode: 'detached-child',
    outcome: 'safety_limit_exceeded',
    limits: ['detached_descendant'],
    overrides: { timeoutMs: 1_500 },
    verify: (report) => report.peaks.pids >= 2,
  });

  const attestation = writeAttestation(probe, cases);
  return {
    schema: 'lamina.safe-runner-self-test/v1',
    passed: attestation.passed,
    qualified_for_production_tiers: attestation.qualified_for_production_tiers,
    adapter: probe,
    attestation,
    cases,
  };
}
