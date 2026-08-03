#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterProbe } from '../scripts/safe-runner/adapter.mjs';
import { infrastructureBinaries } from '../scripts/safe-runner/infrastructure.mjs';
import { runSafely } from '../scripts/safe-runner/runner.mjs';
import { ORACLE_HOST_PROBE_WORKLOAD_ID } from '../scripts/safe-runner/oracle-host-profile.mjs';

if (process.platform !== 'linux') {
  console.log('real repository oracle-host end-to-end live test skipped outside Linux');
  process.exit(0);
}
try { infrastructureBinaries(); } catch (error) {
  if (error?.code !== 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY'
    || error.message !== 'trusted root-owned infrastructure binary is unavailable: bwrap') throw error;
  console.log('real repository oracle-host end-to-end live test skipped: exact bwrap unavailable');
  process.exit(0);
}
const probe = adapterProbe();
if (probe.id !== 'linux-systemd-cgroup-v2' || probe.production_enforcement !== true) {
  console.log('real repository oracle-host end-to-end live test skipped: exact user-systemd scope unavailable');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRYPOINT = path.join(ROOT, 'benchmarks/real-repository-oracle-v1/workload.mjs');
const reportRoot = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-oracle-host-live-report-'),
));
fs.chmodSync(reportRoot, 0o700);
const limits = {
  memoryMaxBytes: 256 * 1024 ** 2,
  memoryHighBytes: 192 * 1024 ** 2,
  pidsMax: 16,
  timeoutMs: 8_000,
  tempMaxBytes: 64 * 1024,
  outputMaxBytes: 64 * 1024,
};
try {
  const reportFile = path.join(reportRoot, 'normal.json');
  const report = await runSafely({
    command: [process.execPath, ENTRYPOINT, 'probe-oracle-host'],
    tier: 'small', cwd: ROOT, reportFile, overrides: limits,
    workloadId: ORACLE_HOST_PROBE_WORKLOAD_ID,
  });
  assert.equal(report.outcome, 'success', JSON.stringify(report.error));
  assert.equal(report.termination.child_exit_code, 0);
  assert.equal(report.output.stderr_bytes, 0);
  assert.equal(report.output.stdout_tail.endsWith('\n'), true);
  assert.equal(report.output.stdout_tail.slice(0, -1).includes('\n'), false);
  const result = JSON.parse(report.output.stdout_tail);
  assert.equal(result.non_gradeable, true);
  assert.equal(result.cleanup_proof_issued, false);
  assert.equal(result.grading_reachable, false);
  assert.equal(result.candidate_executed, false);
  assert.equal(result.enospc_proven, true);
  assert.equal(result.identities_dead, true);
  assert.equal(report.preflight.oracle_host_launch.authorized, true);
  assert.equal(report.preflight.oracle_host_launch.requester.ppid,
    report.preflight.scope_proof.gate_pid);
  assert.equal(report.preflight.temporary_quota_proof.cgroup,
    report.preflight.scope_proof.cgroup);
  assert.equal(report.preflight.oracle_quota_terminal.cleanup_verified, true);
  assert.equal(report.cleanup.scope_removed, true);
  assert.equal(report.cleanup.temporary_directory_removed, true);
  assert.deepEqual(report.cleanup.descendants_remaining, []);
  assert.deepEqual(report.cleanup.errors, []);
  for (const root of report.preflight.execution_snapshot.snapshot_roots) {
    assert.equal(fs.existsSync(root), false);
  }
  assert.doesNotMatch(JSON.stringify(report), /grade_receipt|cleanup_proof_issuer|promotion_receipt/);

  const crashReport = await runSafely({
    command: [process.execPath, ENTRYPOINT, 'probe-oracle-host'],
    tier: 'small', cwd: ROOT, reportFile: path.join(reportRoot, 'pre-release-crash.json'),
    overrides: limits, workloadId: ORACLE_HOST_PROBE_WORKLOAD_ID,
    _testBeforeQuotaRelease() { throw new Error('test pre-release controller failure'); },
  });
  assert.equal(crashReport.outcome, 'internal_error');
  assert.equal(crashReport.cleanup.oracle_quota_abort.cleanup_verified, true);
  assert.equal(crashReport.cleanup.scope_removed, true);
  assert.equal(crashReport.cleanup.temporary_directory_removed, true);
  assert.deepEqual(crashReport.cleanup.descendants_remaining, []);
  assert.deepEqual(crashReport.cleanup.errors, []);
} finally {
  fs.rmSync(reportRoot, { recursive: true, force: true });
}

console.log('real repository oracle-host end-to-end live and pre-release crash passed');
