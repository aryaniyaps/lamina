#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LANDLOCK_CANDIDATE_PROBE_LAUNCH_PROFILE as PROFILE,
  LANDLOCK_CANDIDATE_PROBE_WORKLOAD_ID as WORKLOAD,
} from '../scripts/safe-runner/landlock-candidate-profile.mjs';
import { preflightRun } from '../scripts/safe-runner/preflight.mjs';
import { promotionStatus, recordPromotion } from '../scripts/safe-runner/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRYPOINT = path.join(ROOT, 'tests/fixtures/safe-runner-landlock-probe.mjs');
const LIMITS = {
  memoryMaxBytes: 256 * 1024 ** 2,
  memoryHighBytes: 192 * 1024 ** 2,
  pidsMax: 32,
  timeoutMs: 10_000,
  tempMaxBytes: 64 * 1024 ** 2,
  outputMaxBytes: 1024 * 1024,
};
const adapterInfo = {
  id: 'unit-production', platform: 'linux', production_enforcement: true,
  aggregate_memory: true, aggregate_pids: true, complete_descendant_ownership: true,
  temporary_quota: true, controllers: ['memory', 'pids'], reasons: [],
};
const command = [process.execPath, ENTRYPOINT];
const exact = preflightRun({
  tier: 'small', command, cwd: ROOT, overrides: LIMITS, adapterInfo,
  injectedExistingProcesses: [], workloadId: WORKLOAD,
});
assert.equal(exact.ok, true, exact.reasons.join('\n'));
assert.equal(exact.launch_profile, PROFILE);

for (const refusal of [
  preflightRun({
    tier: 'small', command, cwd: ROOT, overrides: LIMITS, adapterInfo,
    injectedExistingProcesses: [], workloadId: 'spoofed-workload',
  }),
  preflightRun({
    tier: 'medium', command, cwd: ROOT, overrides: LIMITS, adapterInfo,
    injectedExistingProcesses: [], workloadId: WORKLOAD,
  }),
  preflightRun({
    tier: 'small', command, cwd: ROOT,
    overrides: { ...LIMITS, pidsMax: 31 }, adapterInfo,
    injectedExistingProcesses: [], workloadId: WORKLOAD,
  }),
  preflightRun({
    tier: 'small', command, cwd: ROOT, overrides: LIMITS, adapterInfo,
    injectedExistingProcesses: [], workloadId: WORKLOAD, promotionRequested: true,
  }),
]) assert.equal(refusal.ok, false, 'Landlock probe profile mismatch must be refused');

const stateRoot = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-landlock-profile-state-'),
));
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = stateRoot;
try {
  const evidence = {
    outcome: 'success', run_id: 'spoofed-landlock-promotion', command,
    finished_at: new Date(0).toISOString(), adapter: { id: 'unit-production' },
    cleanup: {
      descendants_remaining: [], managed_paths_remaining: [], scope_removed: true,
      temporary_directory_removed: true, errors: [],
    },
    preflight: {},
  };
  assert.throws(() => recordPromotion(
    ROOT, 'small', evidence, 'spoofed-workload', command, { digest: 'a'.repeat(64) },
  ), (error) => error?.code === 'LAMINA_SAFE_PROMOTION_FORBIDDEN');
  assert.deepEqual(promotionStatus(ROOT, 'spoofed-workload'), { completed: [], value: null });
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(stateRoot, { recursive: true, force: true });
}

console.log('real repository oracle Landlock candidate profile passed');
