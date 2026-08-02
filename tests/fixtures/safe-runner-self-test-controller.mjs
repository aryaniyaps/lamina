#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS } from '../../scripts/safe-runner/constants.mjs';
import { baseReport, finishReport, writeReport } from '../../scripts/safe-runner/report.mjs';
import { processIdentity } from '../../scripts/safe-runner/processes.mjs';

const [cwd, reportFile, boundary, , progressFile,
  behavior = 'delayed-marker', delayValue = '5100'] =
  process.argv.slice(2);
const delayMs = Number(delayValue);
if (!cwd || !reportFile || !boundary || !Number.isSafeInteger(delayMs) || delayMs < 0) {
  process.exit(64);
}

fs.writeFileSync(progressFile, `${JSON.stringify({
  controller_pid: process.pid,
  watchdog_process: processIdentity(process.pid),
  unit: 'lamina-safe-delayed-self-test.scope',
  temporary_directory: null,
  watchdog_directory: path.join(path.dirname(reportFile), 'absent-watchdog-state'),
  lock_file: null,
})}\n`, { flag: 'wx', mode: 0o600 });

function writeInterruptedReport({ supervisorCrash = false } = {}) {
  const report = baseReport({ tier: 'small', command: [process.execPath, 'self-test-controller'], cwd });
  report.report_file = reportFile;
  report.adapter = { id: 'linux-systemd-cgroup-v2' };
  report.limits = {
    stdout_tail_max_bytes: DEFAULTS.diagnosticTailBytes,
    stderr_tail_max_bytes: DEFAULTS.diagnosticTailBytes,
  };
  report.preflight = { ok: true };
  report.samples.push({
    elapsed_ms: 1,
    aggregate_rss_bytes: 1,
    cgroup_memory_bytes: 1,
    pids: 1,
    temporary_bytes: 0,
    temporary_inodes: 0,
  });
  report.peaks.aggregate_rss_bytes = 1;
  report.peaks.cgroup_memory_bytes = 1;
  report.peaks.pids = 1;
  report.outcome = 'interrupted';
  report.termination = {
    ...report.termination,
    reason: 'interrupted',
    limit: 'signal',
    requested_signals: supervisorCrash ? ['SIGKILL'] : ['SIGINT'],
    child_signal: supervisorCrash ? 'SIGKILL' : 'SIGINT',
  };
  report.cleanup = {
    attempted: true,
    descendants_remaining: [],
    managed_paths_remaining: [],
    scope_removed: true,
    temporary_directory_removed: true,
    lock_released: true,
    errors: [],
  };
  report.error = supervisorCrash ? {
    code: 'LAMINA_SAFE_SUPERVISOR_CRASH',
    message: 'deterministic self-test controller fixture',
  } : {
    code: 'LAMINA_SAFE_INTERRUPTED',
    message: 'deterministic controller handled SIGINT',
  };
  finishReport(report, Date.now() - 1);
  writeReport(reportFile, report);
}

if (behavior === 'delayed-marker' || behavior === 'handled-sigint') {
  if (behavior === 'handled-sigint') {
    process.once('SIGINT', () => {
      writeInterruptedReport();
      process.exit(0);
    });
    fs.writeFileSync(`${reportFile}.sigint-ready`, `${JSON.stringify({
      report_exists_before_signal: fs.existsSync(reportFile),
    })}\n`, { flag: 'wx', mode: 0o600 });
  } else {
    writeInterruptedReport({ supervisorCrash: true });
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  fs.writeFileSync(`${reportFile}.crash-boundary`, `${JSON.stringify({
    boundary,
    controller_pid: process.pid,
    unit: 'lamina-safe-delayed-self-test.scope',
    cgroup: null,
    temporary_directory: null,
    watchdog_directory: path.join(path.dirname(reportFile), 'absent-watchdog-state'),
    lock_file: null,
    watchdog_process: processIdentity(process.pid),
  })}\n`, { flag: 'wx', mode: 0o600 });
}

setInterval(() => {}, 1_000);
