#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANDIDATE_SMOKE_RECORD_MAX_BYTES,
  CANDIDATE_SMOKE_SANDBOX_CHECKS,
  candidateSmokeAuthority,
  candidateSmokePublicNonce,
  candidateSmokeRecord,
  expectedCandidateSmokeArtifact,
  parseCandidateSmokeRecordLine,
} from '../benchmarks/real-repository-oracle-v1/candidate-smoke.mjs';
import {
  CANDIDATE_RAW_MAX_CANONICAL_BYTES,
} from '../benchmarks/real-repository-oracle-v1/candidate-contract.mjs';
import {
  readBoundedCandidateOutput,
} from '../benchmarks/real-repository-oracle-v1/candidate-smoke-runner.mjs';
import {
  CANDIDATE_SMOKE_LAUNCH_PROFILE,
  CANDIDATE_SMOKE_LIMITS,
  CANDIDATE_SMOKE_OVERRIDES,
  CANDIDATE_SMOKE_WORKLOAD_ID,
  exactCandidateSmokeCommand,
  exactCandidateSmokeLimits,
} from '../scripts/safe-runner/candidate-smoke-profile.mjs';
import { preflightRun } from '../scripts/safe-runner/preflight.mjs';
import { recordPromotion } from '../scripts/safe-runner/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRYPOINT = path.join(ROOT, 'benchmarks/real-repository-oracle-v1/workload.mjs');
const command = [process.execPath, ENTRYPOINT, 'smoke-candidate-small'];
const portable = {
  id: 'portable-process-group', platform: process.platform, production_enforcement: false,
  aggregate_memory: false, aggregate_pids: false, complete_descendant_ownership: false,
  temporary_quota: false, controllers: [], reasons: ['pure contract fixture'],
};

assert.equal(exactCandidateSmokeCommand(command), true);
assert.equal(exactCandidateSmokeCommand([...command, 'extra']), false);
assert.equal(exactCandidateSmokeLimits(CANDIDATE_SMOKE_LIMITS), true);
for (const key of Object.keys(CANDIDATE_SMOKE_LIMITS)) {
  assert.equal(exactCandidateSmokeLimits({
    ...CANDIDATE_SMOKE_LIMITS, [key]: CANDIDATE_SMOKE_LIMITS[key] - 1,
  }), false, `${key} must be exact`);
}

const exact = preflightRun({
  tier: 'small', command, cwd: ROOT, overrides: CANDIDATE_SMOKE_OVERRIDES,
  adapterInfo: portable, injectedExistingProcesses: [], workloadId: CANDIDATE_SMOKE_WORKLOAD_ID,
});
assert.equal(exact.launch_profile, CANDIDATE_SMOKE_LAUNCH_PROFILE);
assert.doesNotMatch(exact.reasons.join('\n'), /candidate smoke requires/);
const promotion = preflightRun({
  tier: 'small', command, cwd: ROOT, overrides: CANDIDATE_SMOKE_OVERRIDES,
  adapterInfo: portable, injectedExistingProcesses: [], workloadId: CANDIDATE_SMOKE_WORKLOAD_ID,
  promotionRequested: true,
});
assert.equal(promotion.launch_profile, CANDIDATE_SMOKE_LAUNCH_PROFILE);
assert.match(promotion.reasons.join('\n'), /non-gradeable candidate smoke cannot be promoted/);
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
const promotionState = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-candidate-smoke-promotion-'));
fs.rmSync(promotionState, { recursive: true });
try {
  process.env.LAMINA_SAFE_RUNNER_STATE_DIR = promotionState;
  const otherCommand = [process.execPath, ENTRYPOINT, 'admit-inventory'];
  const ordinaryEvidence = {
    outcome: 'success', run_id: 'candidate-smoke-promotion-spoof', command: otherCommand,
    adapter: { id: 'pure-contract' }, finished_at: '2026-08-03T00:00:00.000Z',
    preflight: {
      launch_profile: null,
      execution_snapshot: { launch_profile: null },
    },
    cleanup: {
      descendants_remaining: [], managed_paths_remaining: [], scope_removed: true,
      temporary_directory_removed: true, errors: [],
    },
  };
  const promotionSpoofs = [
    {
      label: 'workload ID only', evidence: ordinaryEvidence,
      workloadId: CANDIDATE_SMOKE_WORKLOAD_ID, actualCommand: otherCommand,
    },
    {
      label: 'preflight profile only',
      evidence: {
        ...ordinaryEvidence,
        preflight: {
          launch_profile: CANDIDATE_SMOKE_LAUNCH_PROFILE,
          execution_snapshot: { launch_profile: null },
        },
      },
      workloadId: 'ordinary-workload', actualCommand: otherCommand,
    },
    {
      label: 'snapshot profile only',
      evidence: {
        ...ordinaryEvidence,
        preflight: {
          launch_profile: null,
          execution_snapshot: { launch_profile: CANDIDATE_SMOKE_LAUNCH_PROFILE },
        },
      },
      workloadId: 'ordinary-workload', actualCommand: otherCommand,
    },
    {
      label: 'evidence command only', evidence: { ...ordinaryEvidence, command },
      workloadId: 'ordinary-workload', actualCommand: otherCommand,
    },
    {
      label: 'actual command only', evidence: ordinaryEvidence,
      workloadId: 'ordinary-workload', actualCommand: command,
    },
  ];
  for (const spoof of promotionSpoofs) {
    assert.throws(() => recordPromotion(
      ROOT, 'small', spoof.evidence, spoof.workloadId, spoof.actualCommand,
      { digest: 'a'.repeat(64) },
    ), (error) => error?.code === 'LAMINA_SAFE_PROMOTION_FORBIDDEN'
      && /non-gradeable candidate smoke/.test(error.message), spoof.label);
    assert.equal(fs.existsSync(promotionState), false,
      `${spoof.label} must not create promotion state`);
  }
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(promotionState, { recursive: true, force: true });
}
for (const refusal of [
  { command: [...command, 'extra'], workloadId: CANDIDATE_SMOKE_WORKLOAD_ID, tier: 'small',
    overrides: CANDIDATE_SMOKE_OVERRIDES },
  { command, workloadId: 'spoofed-workload', tier: 'small', overrides: CANDIDATE_SMOKE_OVERRIDES },
  { command, workloadId: CANDIDATE_SMOKE_WORKLOAD_ID, tier: 'medium',
    overrides: CANDIDATE_SMOKE_OVERRIDES },
  ...Object.keys(CANDIDATE_SMOKE_OVERRIDES).map((key) => ({
    command, workloadId: CANDIDATE_SMOKE_WORKLOAD_ID, tier: 'small',
    overrides: {
      ...CANDIDATE_SMOKE_OVERRIDES, [key]: CANDIDATE_SMOKE_OVERRIDES[key] - 1,
    },
  })),
]) {
  const crossed = preflightRun({
    tier: refusal.tier, command: refusal.command, cwd: ROOT, overrides: refusal.overrides,
    adapterInfo: portable, injectedExistingProcesses: [], workloadId: refusal.workloadId,
  });
  assert.equal(crossed.launch_profile, null);
  assert.match(crossed.reasons.join('\n'), /candidate smoke requires/);
}

const authority = candidateSmokeAuthority();
assert.deepEqual(CANDIDATE_SMOKE_SANDBOX_CHECKS, [
  'private-controller-read-denied',
  'proc-metadata-read-denied',
  'command-line-controller-paths-absent',
  'high-inherited-fd-closed',
  'repository-mutation-denied',
  'child-process-denied',
  'tcp-network-denied',
  'udp-network-denied',
  'control-socket-denied',
  'extra-executable-denied',
]);
const repeated = candidateSmokeAuthority();
assert.deepEqual(authority.public_batch, repeated.public_batch);
assert.deepEqual(authority.expected_artifact, expectedCandidateSmokeArtifact(authority));
assert.equal(authority.tier, 'small');
assert.equal(authority.slot_order, 1);
assert.equal(authority.phase, 'first');
assert.equal(authority.scenario.kind, 'clean');
assert.ok(authority.private_rows.length > 0);
const firstPublic = authority.public_batch.requests[0];
const independentlyDerivedNonce = crypto.createHash('sha256')
  .update(['lamina.real-repository-candidate-smoke-public-nonce/v1', 'small', 'clean-1', '1', ''].join('\0'))
  .update(crypto.createHash('sha256').update(firstPublic.request).digest())
  .digest('hex');
assert.equal(firstPublic.nonce, independentlyDerivedNonce);
assert.equal(candidateSmokePublicNonce({
  tier: 'small', slot: 'clean-1', row_order: 1, request: firstPublic.request,
}), independentlyDerivedNonce);
assert.throws(() => candidateSmokePublicNonce({
  tier: 'small', slot: 'clean-1', row_order: 1, request: firstPublic.request,
  case_id: authority.private_rows[0].case_id,
}), /exact public nonce inputs/);
const publicText = JSON.stringify(authority.public_batch);
for (const row of authority.private_rows) {
  assert.equal(publicText.includes(row.case_id), false, 'private case mapping leaked');
}

const record = candidateSmokeRecord({
  authority,
  candidate_result_sha256: authority.expected_result_sha256,
  lease: {
    provenance_digest: authority.expected_lease.provenance_digest,
    start_digest: authority.expected_lease.start_digest,
  },
  release: {
    end_digest: authority.expected_lease.end_digest,
    cleanup_verified: false,
    terminal_disposition: 'awaiting_supervisor_cleanup',
  },
  repository_unchanged: true,
});
const line = `${JSON.stringify(record)}\n`;
assert.ok(Buffer.byteLength(line) <= CANDIDATE_SMOKE_RECORD_MAX_BYTES);
assert.deepEqual(parseCandidateSmokeRecordLine(line), record);
for (const mutate of [
  (value) => { value.non_gradeable = false; },
  (value) => { value.public_input_sha256 = 'f'.repeat(64); },
  (value) => { value.candidate_result_sha256 = 'e'.repeat(64); },
  (value) => { value.lease.start_digest = 'd'.repeat(64); },
  (value) => { value.repository_unchanged = false; },
  (value) => { value.materializer.cleanup_verified = true; },
]) {
  const changed = structuredClone(record);
  mutate(changed);
  assert.throws(() => parseCandidateSmokeRecordLine(`${JSON.stringify(changed)}\n`));
}

const oversizedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-candidate-output-bound-'));
try {
  const oversized = path.join(oversizedRoot, 'oversized-candidate-output.json');
  const descriptor = fs.openSync(oversized, 'wx', 0o600);
  try { fs.ftruncateSync(descriptor, CANDIDATE_RAW_MAX_CANONICAL_BYTES + 1); }
  finally { fs.closeSync(descriptor); }
  assert.throws(() => readBoundedCandidateOutput(oversized),
    /exceeds the bounded parser ceiling/);
} finally {
  fs.rmSync(oversizedRoot, { recursive: true, force: true });
}

console.log('real repository oracle candidate smoke pure contracts passed');
