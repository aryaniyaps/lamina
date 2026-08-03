#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  CANDIDATE_ADAPTER_SCHEMA,
  CANDIDATE_PUBLIC_BATCH_SCHEMA,
  CANDIDATE_RAW_SCHEMA,
  serializeCandidatePublicBatch,
} from '../benchmarks/real-repository-oracle-v1/candidate-contract.mjs';
import * as cleanupProofAuthority from
  '../benchmarks/real-repository-oracle-v1/supervisor-cleanup-proof.mjs';
import {
  HOST_LEASE_EVIDENCE_SCHEMA,
  createCandidateTierPlan,
  gradeCandidateTierRuns,
  issueHostLeaseEvidence,
  issueHostLeaseEvidenceFromOuterReport,
} from '../benchmarks/real-repository-oracle-v1/candidate-grade-controller.mjs';
import { loadReviewedFixture } from
  '../benchmarks/real-repository-oracle-v1/fixture-authority.mjs';
import { baseReport } from '../scripts/safe-runner/report.mjs';

const clone = (value) => structuredClone(value);
const reviewed = loadReviewedFixture();
const adapter = {
  schema: CANDIDATE_ADAPTER_SCHEMA,
  id: 'blocked-host-adapter',
  version: 1,
  input_format: CANDIDATE_PUBLIC_BATCH_SCHEMA,
  output_format: CANDIDATE_RAW_SCHEMA,
};
const CLEANUP_HOST_INIT = Symbol.for('lamina.supervisor-cleanup-proof.host-init');
const CLEANUP_HOST_MINT = Symbol.for('lamina.supervisor-cleanup-proof.host-mint');

function leaseFields(plan, slot, phase, handle, overrides = {}) {
  const collection = reviewed.fixture.collections.find((item) => item.id === plan.collection_id);
  return {
    schema: HOST_LEASE_EVIDENCE_SCHEMA,
    slot_id: slot.slot_id,
    phase,
    opaque_handle: handle,
    repository_url: collection.repository_url,
    resolved_commit: collection.commit,
    tree_oid: collection.tree_oid,
    candidate_policy_sha256: collection.candidate_policy_sha256,
    scenario_digest: slot.scenario_digest,
    provenance_digest: slot.provenance_digest,
    base_digest: slot.base_digest,
    start_digest: slot.base_digest,
    end_digest: slot.base_digest,
    ...overrides,
  };
}

function outerReportFixture() {
  const report = baseReport({
    tier: 'small',
    command: [process.execPath, 'candidate-grade-controller-test'],
    cwd: process.cwd(),
  });
  report.outcome = 'success';
  report.started_at = '2026-08-02T00:00:00.000Z';
  report.finished_at = '2026-08-02T00:00:01.000Z';
  report.duration_ms = 1000;
  report.adapter = {
    id: 'linux-systemd-cgroup-v2',
    production_enforcement: true,
    aggregate_memory: true,
    aggregate_pids: true,
    complete_descendant_ownership: true,
    temporary_quota: true,
  };
  report.limits = {
    memory_max_bytes: 512 * 1024 * 1024,
    memory_high_bytes: 384 * 1024 * 1024,
    pids_max: 32,
    timeout_ms: 180_000,
    temporary_max_bytes: 512 * 1024 * 1024,
    temporary_max_inodes: 8192,
    output_max_bytes: 256 * 1024,
    stdout_tail_max_bytes: 8 * 1024,
    stderr_tail_max_bytes: 8 * 1024,
    graceful_stop_ms: 5000,
  };
  report.preflight = {
    ok: true,
    workload_id: 'real-repository-oracle-v1:candidate-grade-controller-test',
    launch_profile: 'production',
    temporary_inode_reservation: null,
    ownership: {
      proven: true,
      audited_entrypoint: 'benchmarks/real-repository-oracle-v1/workload.mjs',
      executable: process.execPath,
    },
    execution_command: report.command,
    source_identity: {
      repository: process.cwd(),
      command: report.command,
      executable: { path: process.execPath, digest: 'a'.repeat(64) },
      workload_inputs: [],
      retrieval_authority: null,
      runtime_baseline_inputs: null,
      repository_source: 'b'.repeat(64),
      runner_build: 'c'.repeat(64),
      digest: 'd'.repeat(64),
    },
    execution_snapshot: {
      schema: 'lamina.safe-runner-execution-snapshot/v1',
      launch_profile: 'production',
      digest: 'e'.repeat(64),
      file_count: 1,
      total_bytes: 1,
      snapshot_roots: ['/tmp/lamina-snapshot-root'],
      writable_roots: ['/tmp/lamina-writable-root'],
      source_closure: {
        schema: 'lamina.safe-runner-source-closure/v1',
        command: report.command,
        file_count: 1,
        total_bytes: 1,
        paths_sha256: 'f'.repeat(64),
        files_sha256: '0'.repeat(64),
        entrypoint_bytes: '1',
        entrypoint_sha256: '1'.repeat(64),
      },
    },
    execution_identity: {
      repository: process.cwd(),
      command: report.command,
      source_identity_digest: 'd'.repeat(64),
      execution_snapshot_digest: 'e'.repeat(64),
      digest: '1'.repeat(64),
    },
    promotion: {
      ok: true,
      required: [],
      missing: [],
      completed: [],
      deferred_to_execution_snapshot: false,
    },
    scope_proof: { production_enforcement: true },
    retry: { ok: true, signature: 'd'.repeat(64), previous: null },
  };
  report.samples = [{
    elapsed_ms: 1,
    aggregate_rss_bytes: 1,
    cgroup_memory_bytes: 1,
    pids: 1,
    temporary_bytes: 1,
    temporary_inodes: 1,
  }];
  report.peaks = {
    aggregate_rss_bytes: 1,
    cgroup_memory_bytes: 1,
    pids: 1,
    temporary_bytes: 1,
    temporary_inodes: 1,
  };
  report.descendants = [];
  report.output = {
    stdout_bytes: 0,
    stderr_bytes: 0,
    total_bytes: 0,
    stdout_tail: '',
    stderr_tail: '',
    truncated: false,
  };
  report.termination = {
    reason: 'completed',
    limit: null,
    requested_signals: [],
    child_exit_code: 0,
    child_signal: null,
    cgroup_events: {},
  };
  report.cleanup = {
    attempted: true,
    descendants_remaining: [],
    managed_paths_remaining: [],
    scope_removed: true,
    temporary_directory_removed: true,
    lock_released: null,
    errors: [],
  };
  report.error = null;
  return report;
}

const plan = createCandidateTierPlan('small');
assert.equal(Object.isFrozen(plan), true);
assert.equal(Object.isFrozen(plan.slots[0].private_rows[0]), true);
assert.equal(plan.slots.length, 6);
assert.deepEqual(plan.slots.map((slot) => slot.private_rows.length), [19, 1, 1, 1, 1, 1]);
assert.equal(plan.slots[0].scenario.kind, 'clean');
assert.deepEqual(new Set(plan.slots.slice(1).map((slot) => slot.scenario.kind)),
  new Set(['dirty', 'branch', 'worktree']));
assert.equal(plan.slots.flatMap((slot) => slot.private_rows).length, 24);
assert.equal(new Set(plan.slots.flatMap((slot) =>
  slot.private_rows.map((row) => row.nonce))).size, 24);
for (const slot of plan.slots) {
  assert.deepEqual(Object.keys(slot.public_batch).sort(), [
    'persona_probe', 'public_input_sha256', 'requests', 'schema', 'tier', 'tier_seed',
  ]);
  const publicText = serializeCandidatePublicBatch(slot.public_batch).toString('utf8');
  for (const privateName of ['case_id', 'scenario', 'fixture', 'expected', 'grade', 'attestation']) {
    assert.equal(publicText.includes(`"${privateName}"`), false,
      `public batch must not serialize private authority ${privateName}`);
  }
}

assert.deepEqual(Object.keys(cleanupProofAuthority), ['verifyIssuedSupervisorCleanupProof'],
  'production cleanup proof authority exposes verification only');
const slot = plan.slots[0];
const fields = leaseFields(plan, slot, 'first', 'lease-pending-supervisor-cleanup-0001');
const outerReport = outerReportFixture();
for (const proof of [undefined, true, {}, Object.freeze({ cleanup_verified: true })]) {
  assert.throws(() => issueHostLeaseEvidence(plan, fields, proof),
    /was not issued by the host authority/,
    'plain caller proof material cannot create gradeable lease evidence');
}
const callerProof = Object.freeze({
  slot_id: slot.slot_id,
  phase: 'first',
  opaque_handle: fields.opaque_handle,
  end_digest: fields.end_digest,
  cleanup_verified: true,
});
for (const proof of [callerProof, clone(callerProof)]) {
  assert.throws(() => issueHostLeaseEvidence(plan, fields, proof),
    /was not issued by the host authority/,
    'caller and cloned proof objects remain unissued');
}
assert.throws(() => issueHostLeaseEvidence(plan, {
  ...fields, cleanup_verified: true,
}, callerProof), /invalid identity, slot, phase, or fields/,
'caller-supplied cleanup_verified is rejected before proof verification');

const otherPlan = createCandidateTierPlan('small');
assert.throws(() => issueHostLeaseEvidence(otherPlan, leaseFields(
  otherPlan, otherPlan.slots[0], 'first', fields.opaque_handle,
), cleanupProofAuthority.verifyIssuedSupervisorCleanupProof[CLEANUP_HOST_MINT](
  cleanupProofAuthority.verifyIssuedSupervisorCleanupProof[CLEANUP_HOST_INIT](),
  outerReport,
  {
    plan,
    slot_id: fields.slot_id,
    phase: fields.phase,
    opaque_handle: fields.opaque_handle,
    end_digest: fields.end_digest,
  },
)), /belongs to different plan/,
'a proof minted for one plan cannot be transplanted to another issued plan');

const incompleteReport = clone(outerReport);
incompleteReport.cleanup.descendants_remaining = [process.pid];
assert.throws(() => issueHostLeaseEvidenceFromOuterReport(plan, fields, incompleteReport),
  /cleanup is incomplete|complete verified cleanup/,
  'incomplete outer cleanup cannot mint gradeable lease evidence');

const lease = issueHostLeaseEvidenceFromOuterReport(plan, fields, outerReport);
assert.equal(lease.cleanup_verified, true);
assert.equal(lease.opaque_handle, fields.opaque_handle);
assert.throws(() => issueHostLeaseEvidenceFromOuterReport(plan, fields, outerReport),
  /lease handle .* was already issued/,
  'duplicate lease handles remain fail-closed');

assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: adapter, records: [],
}), /records do not exactly cover six slots and two independent phases/,
'candidate grading still requires complete run records after lease issuance');
assert.throws(() => gradeCandidateTierRuns({
  plan: clone(plan), expected_adapter: adapter, records: [],
}), /plan was not issued/);

console.log('real repository oracle private candidate grade controller cleanup proof passed');
