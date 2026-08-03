#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createCandidateTierPlan } from
  '../benchmarks/real-repository-oracle-v1/candidate-grade-controller.mjs';
import {
  candidateLeaseWorkerAuthority,
  deriveDeterministicCandidateSlot,
} from '../benchmarks/real-repository-oracle-v1/candidate-lease-worker.mjs';
import {
  cleanScenarioSlots,
  leaseWorkerOpaqueHandle,
} from '../benchmarks/real-repository-oracle-v1/candidate-lease-worker-controller.mjs';
import { loadReviewedFixture } from
  '../benchmarks/real-repository-oracle-v1/fixture-authority.mjs';

const plan = createCandidateTierPlan('small');
const cleanSlots = cleanScenarioSlots(plan);
assert.ok(cleanSlots.length >= 1, 'small tier must expose at least one clean scenario slot');
const slot = cleanSlots[0];
const deterministicSlot = deriveDeterministicCandidateSlot('small', slot.slot_id);
const authority = candidateLeaseWorkerAuthority({
  tier: 'small', slot_id: slot.slot_id, phase: 'first',
});
assert.equal(authority.public_batch.public_input_sha256,
  deterministicSlot.public_batch.public_input_sha256);
assert.equal(authority.scenario.kind, 'clean');
const reviewed = loadReviewedFixture();
const collection = reviewed.fixture.collections.find((item) => item.id === plan.collection_id);
const nonce = slot.private_rows[0].nonce;
assert.equal(typeof nonce, 'string');
assert.match(nonce, /^[a-f0-9]{64}$/);
assert.throws(
  () => candidateLeaseWorkerAuthority({ tier: 'small', slot_id: 'slot-999', phase: 'first' }),
  /unknown/,
);
assert.match(leaseWorkerOpaqueHandle('small', slot.slot_id, 'first'),
  /^candidate-lease-small-slot-\d+-first$/);

console.log('real repository oracle candidate lease worker pure contracts passed');
