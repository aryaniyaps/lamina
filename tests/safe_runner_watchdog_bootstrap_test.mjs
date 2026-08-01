#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCrashWatchdog } from '../scripts/safe-runner/crash-watchdog-controller.mjs';
import { removeOwnedDirectory } from '../scripts/safe-runner/filesystem.mjs';
import {
  baseReport, finishReport, prepareReportAuthority, validateReport,
} from '../scripts/safe-runner/report.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-watchdog-bootstrap-test-'));
const adapter = {
  id: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-bootstrap-contract.scope', systemdMajor: 252,
};
const authority = (name) => {
  const reportFile = path.join(root, `${name}.json`);
  const report = baseReport({
    tier: 'small', command: [process.execPath, 'bootstrap-contract'], cwd: process.cwd(),
  });
  report.report_file = reportFile;
  report.outcome = 'internal_error';
  report.termination.reason = 'run_in_progress';
  report.error = { code: 'LAMINA_SAFE_RUN_IN_PROGRESS', message: 'bootstrap contract in progress' };
  finishReport(report, Date.now());
  return { report, reportFile, reportAuthority: prepareReportAuthority(reportFile, report) };
};

try {
  const normalAuthority = authority('normal');
  const watchdog = await startCrashWatchdog({
    ...normalAuthority, adapter, acquireLock: true,
  });
  assert.ok(fs.existsSync(watchdog.directory));
  assert.ok(fs.existsSync(watchdog.temporaryDirectory));
  assert.ok(fs.existsSync(watchdog.payloadTemporaryDirectory));
  assert.ok(fs.existsSync(watchdog.lock.file));
  assert.equal(removeOwnedDirectory(watchdog.temporaryDirectory,
    'lamina-safe-runner-', watchdog.temporaryDirectoryIdentity), true);
  assert.equal(watchdog.lock.release(), true);
  assert.equal(await watchdog.disarm(), true);

  const timeoutMarker = path.join(root, 'timeout-marker.json');
  const timeoutAuthority = authority('timeout');
  await assert.rejects(startCrashWatchdog({
    ...timeoutAuthority, adapter, acquireLock: true,
    testCrashBoundary: 'watchdog_state_created', testCrashMarkerFile: timeoutMarker,
  }), /did not become ready/);
  const timeoutState = JSON.parse(fs.readFileSync(timeoutMarker, 'utf8'));
  assert.equal(fs.existsSync(timeoutState.watchdog_directory), false,
    'ready timeout must remove the exact child-created watchdog directory');
  assert.equal(timeoutState.temporary_directory, null);
  assert.equal(timeoutState.lock_file, null);
  assert.equal(validateReport(JSON.parse(fs.readFileSync(timeoutAuthority.reportFile, 'utf8'))).valid, true);

  const exitMarker = path.join(root, 'exit-marker.json');
  const exitAuthority = authority('exit');
  await assert.rejects(startCrashWatchdog({
    ...exitAuthority, adapter, acquireLock: true,
    testCrashMarkerFile: exitMarker, testBootstrapFailure: 'exit_after_lock',
  }), /exited before ready/);
  const exitState = JSON.parse(fs.readFileSync(exitMarker, 'utf8'));
  assert.equal(fs.existsSync(exitState.watchdog_directory), false);
  assert.equal(fs.existsSync(exitState.temporary_directory), false);
  assert.equal(fs.existsSync(exitState.lock_file), false,
    'child exit must release only the exact progress-reported lock');
  assert.equal(validateReport(JSON.parse(fs.readFileSync(exitAuthority.reportFile, 'utf8'))).valid, true);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('safe-runner watchdog bootstrap contracts passed');
