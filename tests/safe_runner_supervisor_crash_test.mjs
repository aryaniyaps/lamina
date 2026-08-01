#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runSupervisorCrashSelfTest,
  SUPERVISOR_CRASH_PREPARATION_TIMEOUT_MS,
  SUPERVISOR_CRASH_REPORT_TIMEOUT_MS,
} from '../scripts/safe-runner/self-test.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-supervisor-crash-test-'));
const reports = path.join(root, 'reports');
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
const fixture = path.resolve('tests/fixtures/safe-runner-self-test-controller.mjs');
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'state');
fs.mkdirSync(reports, { recursive: true, mode: 0o700 });

try {
  assert.equal(SUPERVISOR_CRASH_PREPARATION_TIMEOUT_MS, 30_000);
  assert.equal(SUPERVISOR_CRASH_REPORT_TIMEOUT_MS, 10_000);

  const delayed = await runSupervisorCrashSelfTest({
    cwd: process.cwd(),
    reportDirectory: reports,
    _testControllerFixture: fixture,
    _testControllerArguments: ['delayed-marker', '5100'],
    _testReportTimeoutMs: 2_000,
  });
  assert.equal(delayed.diagnostic, null,
    'preparation lasting longer than five seconds must still reach the requested boundary');
  assert.equal(delayed.passed, true, JSON.stringify(delayed, null, 2));
  assert.equal(delayed.report.samples.length, 1);

  const missing = await runSupervisorCrashSelfTest({
    cwd: process.cwd(),
    reportDirectory: reports,
    boundary: 'payload_released',
    _testControllerArguments: ['5000'],
    _testPreparationTimeoutMs: 3_000,
    _testReportTimeoutMs: 10_000,
  });
  assert.equal(missing.passed, false);
  assert.equal(missing.diagnostic?.code, 'boundary_not_reached');
  assert.equal(missing.diagnostic?.boundary, 'payload_released');
  assert.equal(missing.diagnostic?.preparation_timeout_ms, 3_000);
  assert.equal(missing.diagnostic?.report_observed, true);
  assert.equal(missing.diagnostic?.exact_cleanup_proven, true);
  assert.equal(missing.diagnostic?.authoritative_cleanup_proven, true);
  assert.equal(missing.evidence.controller_dead, true);
  assert.equal(missing.report?.error?.code, 'LAMINA_SAFE_SUPERVISOR_CRASH',
    'missing-boundary handling must still wait for the bounded crash report');
  assert.equal(missing.report?.termination?.reason, 'supervisor_crash_before_payload');

  const runner = fs.readFileSync('scripts/safe-runner/runner.mjs', 'utf8');
  const scopeSample = runner.indexOf('rememberDescendants(report, proof.records');
  const unarmed = runner.indexOf('armed: false', scopeSample);
  const beforeRelease = runner.indexOf("crashBoundary('before_payload_release')", unarmed);
  const release = runner.indexOf('await releaseFifo(quotaReleaseFile)', beforeRelease);
  const armed = runner.indexOf('crashWatchdog?.update({ report_seed: report, armed: true })', release);
  const releasedMarker = runner.indexOf("crashBoundary('payload_released')", armed);
  assert.ok(scopeSample >= 0 && scopeSample < unarmed && unarmed < beforeRelease
    && beforeRelease < release && release < armed && armed < releasedMarker,
  'scope evidence must remain unarmed until final quota release, then arm atomically before the marker');
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('safe-runner supervisor crash timing contracts passed');
