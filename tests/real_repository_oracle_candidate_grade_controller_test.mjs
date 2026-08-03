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
} from '../benchmarks/real-repository-oracle-v1/candidate-grade-controller.mjs';
import { loadReviewedFixture } from
  '../benchmarks/real-repository-oracle-v1/fixture-authority.mjs';

const clone = (value) => structuredClone(value);
const reviewed = loadReviewedFixture();
const adapter = {
  schema: CANDIDATE_ADAPTER_SCHEMA,
  id: 'blocked-host-adapter',
  version: 1,
  input_format: CANDIDATE_PUBLIC_BATCH_SCHEMA,
  output_format: CANDIDATE_RAW_SCHEMA,
};

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
for (const proof of [undefined, true, {}, Object.freeze({ cleanup_verified: true })]) {
  assert.throws(() => issueHostLeaseEvidence(plan, fields, proof),
    /cleanup proof is unavailable pending issue #59 integration/,
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
    /cleanup proof is unavailable pending issue #59 integration/,
    'caller and cloned proof objects remain unissued');
}
assert.throws(() => issueHostLeaseEvidence(plan, {
  ...fields, cleanup_verified: true,
}, callerProof), /invalid identity, slot, phase, or fields/,
'caller-supplied cleanup_verified is rejected before proof verification');

const otherPlan = createCandidateTierPlan('small');
assert.throws(() => issueHostLeaseEvidence(otherPlan, leaseFields(
  otherPlan, otherPlan.slots[0], 'first', fields.opaque_handle,
), callerProof), /cleanup proof is unavailable pending issue #59 integration/,
'a caller proof cannot be transplanted to another issued plan');
assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: adapter, records: [],
}), /records do not exactly cover six slots and two independent phases/,
'candidate grading remains unreachable without supervisor-issued cleanup receipts');
assert.throws(() => gradeCandidateTierRuns({
  plan: clone(plan), expected_adapter: adapter, records: [],
}), /plan was not issued/);

console.log('real repository oracle private candidate grade controller is fail-closed pending #59');
