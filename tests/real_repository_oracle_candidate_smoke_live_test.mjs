#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeCandidateSmokeReport } from '../benchmarks/real-repository-oracle-v1/candidate-smoke-report.mjs';
import { adapterProbe } from '../scripts/safe-runner/adapter.mjs';
import {
  CANDIDATE_SMOKE_LAUNCH_PROFILE,
  CANDIDATE_SMOKE_OVERRIDES,
  CANDIDATE_SMOKE_WORKLOAD_ID,
} from '../scripts/safe-runner/candidate-smoke-profile.mjs';
import { infrastructureBinaries } from '../scripts/safe-runner/infrastructure.mjs';
import { runSafely } from '../scripts/safe-runner/runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRYPOINT = path.join(ROOT, 'benchmarks/real-repository-oracle-v1/workload.mjs');

if (process.platform !== 'linux') {
  console.log('real repository oracle candidate smoke skipped outside Linux');
  process.exit(0);
}
try { infrastructureBinaries(); } catch (error) {
  if (error?.code !== 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY') throw error;
  console.log(`real repository oracle candidate smoke skipped: ${error.message}`);
  process.exit(0);
}
const adapter = adapterProbe();
if (adapter.id !== 'linux-systemd-cgroup-v2' || adapter.production_enforcement !== true) {
  console.log('real repository oracle candidate smoke skipped: production scope unavailable');
  process.exit(0);
}

const reportRoot = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-candidate-smoke-live-'),
));
fs.chmodSync(reportRoot, 0o700);
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(reportRoot, 'state');
try {
  const report = await runSafely({
    command: [process.execPath, ENTRYPOINT, 'smoke-candidate-small'],
    tier: 'small', cwd: ROOT, reportFile: path.join(reportRoot, 'report.json'),
    workloadId: CANDIDATE_SMOKE_WORKLOAD_ID,
    overrides: CANDIDATE_SMOKE_OVERRIDES,
  });
  const primitiveUnavailable = report.outcome === 'error'
    && /Landlock ABI is outside reviewed|landlock_create_ruleset\(VERSION\)|seccomp\(SECCOMP_SET_MODE_FILTER\)/
      .test(report.error?.message || '');
  if (primitiveUnavailable) {
    console.log(`real repository oracle candidate smoke skipped: ${report.error.message}`);
    process.exit(0);
  }
  assert.equal(report.outcome, 'success', JSON.stringify({
    error: report.error, output: report.output,
  }));
  assert.equal(report.preflight.launch_profile, CANDIDATE_SMOKE_LAUNCH_PROFILE);
  assert.equal(report.preflight.execution_snapshot.launch_profile,
    CANDIDATE_SMOKE_LAUNCH_PROFILE);
  assert.equal(report.output.truncated, false);
  assert.equal(report.output.stderr_bytes, 0);
  assert.equal(report.output.stdout_bytes,
    Buffer.byteLength(report.output.stdout_tail, 'utf8'));
  const decoded = decodeCandidateSmokeReport(report);
  const { record } = decoded;
  assert.equal(decoded.outer_cleanup_authenticated, true);
  assert.equal(decoded.cleanup_proof_issued, false);
  assert.equal(decoded.grading_reachable, false);
  assert.equal(record.non_gradeable, true);
  assert.equal(record.grading_reachable, false);
  assert.equal(record.cleanup_proof_issued, false);
  assert.equal(record.repository_unchanged, true);
  assert.deepEqual(record.materializer, {
    cleanup_verified: false,
    terminal_disposition: 'awaiting_supervisor_cleanup',
  });
  assert.deepEqual(report.cleanup.descendants_remaining, []);
  assert.deepEqual(report.cleanup.managed_paths_remaining, []);
  assert.equal(report.cleanup.scope_removed, true);
  assert.equal(report.cleanup.temporary_directory_removed, true);
  assert.deepEqual(report.cleanup.errors, []);
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(reportRoot, { recursive: true, force: true });
}

console.log('real repository oracle candidate smoke live execution passed');
