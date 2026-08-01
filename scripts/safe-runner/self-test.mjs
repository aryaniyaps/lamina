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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, '../../tests/fixtures/safe-runner-adversary.mjs');
const CONTROLLER_FIXTURE = path.resolve(HERE, '../../tests/fixtures/safe-runner-controller.mjs');
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
}) {
  const safeBoundary = boundary.replace(/[^a-z0-9_-]/gi, '-');
  const crashReportPath = path.join(reportDirectory, `parent_signal_sigkill_${safeBoundary}.json`);
  const armedFile = `${crashReportPath}.crash-boundary`;
  fs.rmSync(crashReportPath, { force: true });
  fs.rmSync(armedFile, { force: true });
  if (previousReport) fs.writeFileSync(crashReportPath, `${JSON.stringify(previousReport)}\n`);
  const controller = spawn(process.execPath, [
    CONTROLLER_FIXTURE, cwd, crashReportPath, boundary, graphRepository || '',
  ], {
    cwd, env: sanitizedEnvironment(process.env), stdio: 'ignore',
  });
  let armed = null;
  const armedDeadline = Date.now() + 5_000;
  while (Date.now() < armedDeadline && controller.exitCode === null) {
    try { armed = JSON.parse(fs.readFileSync(armedFile, 'utf8')); break; } catch {}
    await wait(20);
  }
  let crashReport = null;
  const evidence = {
    controller_dead: false, scope_absent: false, temporary_removed: false,
    watchdog_state_removed: false, lock_removed: false, subsequent_claim: false,
    descendants_absent: false, managed_paths_absent: false, schema_valid: false,
  };
  if (armed?.controller_pid === controller.pid
    && (typeof armed.unit === 'string' || boundary === 'report_slot_acquired')) {
    controller.kill('SIGKILL');
    if (controller.exitCode === null) await once(controller, 'exit');
    evidence.controller_dead = controller.exitCode !== null || controller.signalCode === 'SIGKILL';
    const reportDeadline = Date.now() + (boundary === 'report_slot_acquired' ? 250 : 5_000);
    while (Date.now() < reportDeadline) {
      try {
        const candidate = JSON.parse(fs.readFileSync(crashReportPath, 'utf8'));
        if (boundary === 'report_slot_acquired'
          || candidate?.error?.code === 'LAMINA_SAFE_SUPERVISOR_CRASH'
          || candidate?.error?.code === 'LAMINA_SAFE_CLEANUP_INCOMPLETE') {
          crashReport = candidate;
          break;
        }
      } catch {}
      await wait(20);
    }
    const shown = boundary === 'report_slot_acquired' ? null
      : spawnSync(infrastructureBinaries().systemctl, [
        '--user', 'show', armed.unit, '--property=LoadState', '--property=ControlGroup',
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
      || (armed.temporary_directory === null
        || (typeof armed.temporary_directory === 'string' && !fs.existsSync(armed.temporary_directory)));
    evidence.watchdog_state_removed = boundary === 'report_slot_acquired'
      || (typeof armed.watchdog_directory === 'string' && !fs.existsSync(armed.watchdog_directory));
    evidence.lock_removed = boundary === 'report_slot_acquired'
      || armed.lock_file === null
      || (typeof armed.lock_file === 'string' && !lstatPresence(armed.lock_file).exists);
    evidence.descendants_absent = boundary === 'report_slot_acquired'
      || crashReport?.cleanup?.descendants_remaining?.length === 0;
    evidence.managed_paths_absent = boundary === 'report_slot_acquired'
      || crashReport?.cleanup?.managed_paths_remaining?.length === 0;
    evidence.schema_valid = validateReport(crashReport || {}).valid;
  } else if (controller.exitCode === null) {
    controller.kill('SIGKILL');
    await once(controller, 'exit');
  }
  fs.rmSync(armedFile, { force: true });
  const earlyPreparationPassed = boundary === 'report_slot_acquired'
    && crashReport?.outcome === 'internal_error'
    && crashReport?.termination?.reason === 'run_in_progress'
    && crashReport?.error?.code === 'LAMINA_SAFE_RUN_IN_PROGRESS'
    && Object.values(evidence).every(Boolean);
  const snapshotPreparationPassed = boundary === 'snapshot_building'
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
  const passed = earlyPreparationPassed || bootstrapPreparationPassed
    || snapshotPreparationPassed || (crashReport?.outcome === 'interrupted'
    && crashReport?.error?.code === 'LAMINA_SAFE_SUPERVISOR_CRASH'
    && crashReport?.cleanup?.scope_removed === true
    && crashReport?.cleanup?.temporary_directory_removed === true
    && crashReport?.cleanup?.descendants_remaining?.length === 0
    && crashReport?.cleanup?.errors?.length === 0
    && crashReport?.cleanup?.lock_released === true
    && crashReport?.termination?.requested_signals?.includes('SIGKILL')
    && Object.values(evidence).every(Boolean));
  return { passed, report: crashReport, report_path: crashReportPath, evidence };
}

export async function runHandledParentSignalSelfTest({ cwd, reportDirectory }) {
  const reportPath = path.join(reportDirectory, 'parent_signal_host_sigint.json');
  const armedFile = `${reportPath}.crash-boundary`;
  fs.rmSync(reportPath, { force: true });
  fs.rmSync(armedFile, { force: true });
  const controller = spawn(process.execPath, [CONTROLLER_FIXTURE, cwd, reportPath], {
    cwd, env: sanitizedEnvironment(process.env), stdio: 'ignore',
  });
  let armed = null;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && controller.exitCode === null) {
    try { armed = JSON.parse(fs.readFileSync(armedFile, 'utf8')); break; } catch {}
    await wait(20);
  }
  if (armed?.controller_pid === controller.pid) controller.kill('SIGINT');
  else controller.kill('SIGKILL');
  if (controller.exitCode === null) await once(controller, 'exit');
  let report = null;
  const reportDeadline = Date.now() + 5_000;
  while (Date.now() < reportDeadline) {
    try {
      const candidate = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (candidate?.error?.code !== 'LAMINA_SAFE_RUN_IN_PROGRESS') {
        report = candidate;
        break;
      }
    } catch {}
    await wait(20);
  }
  fs.rmSync(armedFile, { force: true });
  const passed = report?.outcome === 'interrupted'
    && report?.termination?.limit === 'signal'
    && report?.cleanup?.scope_removed === true
    && report?.cleanup?.temporary_directory_removed === true
    && report?.cleanup?.errors?.length === 0
    && validateReport(report).valid;
  return { passed, report, report_path: reportPath };
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
    handled_host_sigint: { passed: handled.passed, report: handled.report_path },
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
