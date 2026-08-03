#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanScenarioSlots,
  isCandidateLeaseWorkerControllerVerification,
  runCandidateLeaseWorkerThroughSafeRunner,
} from '../benchmarks/real-repository-oracle-v1/candidate-lease-worker-controller.mjs';
import { createCandidateTierPlan } from
  '../benchmarks/real-repository-oracle-v1/candidate-grade-controller.mjs';
import { adapterProbe } from '../scripts/safe-runner/adapter.mjs';
import { infrastructureBinaries } from '../scripts/safe-runner/infrastructure.mjs';

if (process.platform !== 'linux') {
  console.log('real repository oracle candidate lease worker skipped outside Linux');
  process.exit(0);
}
try { infrastructureBinaries(); } catch (error) {
  if (error?.code !== 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY') throw error;
  console.log(`real repository oracle candidate lease worker skipped: ${error.message}`);
  process.exit(0);
}
const adapter = adapterProbe();
if (adapter.id !== 'linux-systemd-cgroup-v2' || adapter.production_enforcement !== true) {
  console.log('real repository oracle candidate lease worker skipped: production scope unavailable');
  process.exit(0);
}

const plan = createCandidateTierPlan('small');
const slot = cleanScenarioSlots(plan)[0];
const reportRoot = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-candidate-lease-worker-live-'),
));
fs.chmodSync(reportRoot, 0o700);
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(reportRoot, 'state');
try {
  let verification;
  try {
    verification = await runCandidateLeaseWorkerThroughSafeRunner({
      reportFile: path.join(reportRoot, 'lease.json'),
      tier: 'small',
      slot_id: slot.slot_id,
      phase: 'first',
    });
  } catch (error) {
    if (/Landlock ABI is outside reviewed|landlock_create_ruleset\(VERSION\)|seccomp\(SECCOMP_SET_MODE_FILTER\)/
      .test(error?.message || '')) {
      console.log(`real repository oracle candidate lease worker skipped: ${error.message}`);
      process.exit(0);
    }
    throw error;
  }
  assert.equal(isCandidateLeaseWorkerControllerVerification(verification), true);
  assert.equal(verification.lease_evidence_issued, true);
  assert.equal(verification.runs.length, 1);
  assert.equal(verification.runs[0].worker.oracle_worker.broker_finish_verified, true);
  assert.equal(verification.runs[0].lease_evidence.cleanup_verified, true);
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(reportRoot, { recursive: true, force: true });
}

console.log('real repository oracle candidate lease worker live execution passed');
