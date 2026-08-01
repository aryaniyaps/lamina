import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterProbe } from './adapter.mjs';
import { MIB } from './constants.mjs';
import { runSafely } from './runner.mjs';
import { acquireConcurrencyLock, stateDirectory, writeAttestation } from './state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, '../../tests/fixtures/safe-runner-adversary.mjs');

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

export async function runAdversarialSelfTests({ cwd = process.cwd() } = {}) {
  const probe = adapterProbe();
  const reportDirectory = path.join(stateDirectory(), 'self-tests');
  fs.mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });
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
      passed: expected(report, outcome, limits) && verify(report),
      outcome: report.outcome,
      termination_reason: report.termination.reason,
      limit: report.termination.limit,
      peak_rss_bytes: report.peaks.aggregate_rss_bytes,
      peak_pids: report.peaks.pids,
      requested_signals: report.termination.requested_signals,
      cleanup_verified: cleanupVerified(report),
      report_digest: digest(report),
      report: report.report_file,
    };
    cases.push(record);
  };

  await runCase({ id: 'normal_cleanup', fixtureMode: 'success', outcome: 'success' });
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
  await runCase({
    id: 'parent_signal', fixtureMode: 'signal-controller', outcome: 'interrupted', limits: ['signal'],
    overrides: { timeoutMs: 1_000 },
  });

  const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  const staleDirectory = path.join(reportDirectory, 'stale-lock-state');
  const claims = path.join(staleDirectory, 'production-locks');
  fs.mkdirSync(claims, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(claims, 'stale.json'), JSON.stringify({
    pid: process.pid,
    start_ticks: 'stale-identity-that-cannot-match',
    nonce: 'stale',
  }), { mode: 0o600 });
  process.env.LAMINA_SAFE_RUNNER_STATE_DIR = staleDirectory;
  let stalePassed = false;
  try {
    const lock = acquireConcurrencyLock();
    stalePassed = lock.release() === true
      && fs.readdirSync(claims).filter((name) => name.endsWith('.json')).length === 0;
  } finally {
    if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
    else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  }
  const staleEvidence = { stalePassed, claims: fs.readdirSync(claims) };
  cases.push({
    id: 'stale_process_record',
    passed: stalePassed,
    outcome: 'cleanup_verified',
    cleanup_verified: stalePassed,
    report_digest: digest(staleEvidence),
    report: null,
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
