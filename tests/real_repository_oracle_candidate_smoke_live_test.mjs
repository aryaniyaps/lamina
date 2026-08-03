#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isCandidateSmokeControllerVerification,
  runCandidateSmokeThroughSafeRunner,
} from '../benchmarks/real-repository-oracle-v1/candidate-smoke-controller.mjs';
import { adapterProbe } from '../scripts/safe-runner/adapter.mjs';
import { infrastructureBinaries } from '../scripts/safe-runner/infrastructure.mjs';

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
  let verification;
  try {
    verification = await runCandidateSmokeThroughSafeRunner({
      reportFile: path.join(reportRoot, 'report.json'),
    });
  } catch (error) {
    if (/Landlock ABI is outside reviewed|landlock_create_ruleset\(VERSION\)|seccomp\(SECCOMP_SET_MODE_FILTER\)/
      .test(error?.message || '')) {
      console.log(`real repository oracle candidate smoke skipped: ${error.message}`);
      process.exit(0);
    }
    throw error;
  }
  assert.equal(isCandidateSmokeControllerVerification(verification), true);
  assert.equal(isCandidateSmokeControllerVerification(structuredClone(verification)), false);
  assert.equal(isCandidateSmokeControllerVerification(Object.freeze({ ...verification })), false);
  assert.equal(verification.outer_cleanup_verified, true);
  assert.equal(verification.cleanup_proof_issued, false);
  assert.equal(verification.grading_reachable, false);
  const { record } = verification;
  assert.equal(record.non_gradeable, true);
  assert.equal(record.grading_reachable, false);
  assert.equal(record.cleanup_proof_issued, false);
  assert.equal(record.repository_unchanged, true);
  assert.deepEqual(record.materializer, {
    cleanup_verified: false,
    terminal_disposition: 'awaiting_supervisor_cleanup',
  });
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(reportRoot, { recursive: true, force: true });
}

console.log('real repository oracle candidate smoke live execution passed');
