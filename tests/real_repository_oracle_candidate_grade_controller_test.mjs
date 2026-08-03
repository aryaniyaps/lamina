#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  CANDIDATE_ADAPTER_SCHEMA,
  CANDIDATE_PUBLIC_BATCH_SCHEMA,
  CANDIDATE_RAW_SCHEMA,
  PERSONA_PROBE_EVIDENCE_SCHEMA,
  canonicalCandidateValue,
  serializeCandidatePublicBatch,
  serializeCandidateRawArtifact,
} from '../benchmarks/real-repository-oracle-v1/candidate-contract.mjs';
import {
  HOST_LEASE_EVIDENCE_SCHEMA,
  createCandidateTierPlan,
  gradeCandidateSideBySide,
  gradeCandidateTierRuns,
  issueHostLeaseEvidence,
} from '../benchmarks/real-repository-oracle-v1/candidate-grade-controller.mjs';
import { digest } from '../benchmarks/real-repository-oracle-v1/contract.mjs';
import { loadReviewedFixture } from '../benchmarks/real-repository-oracle-v1/fixture-authority.mjs';
import { gradeResult } from '../benchmarks/real-repository-oracle-v1/grade.mjs';
import { brownfieldSignals } from '../packages/cli/lib/observation-runtime/node.mjs';

const clone = (value) => structuredClone(value);
const canonicalBytes = (value) => Buffer.from(JSON.stringify(canonicalCandidateValue(value)));
const adapter = (id) => ({
  schema: CANDIDATE_ADAPTER_SCHEMA,
  id,
  version: 1,
  input_format: CANDIDATE_PUBLIC_BATCH_SCHEMA,
  output_format: CANDIDATE_RAW_SCHEMA,
});
const currentAdapter = adapter('current-host-adapter');
const candidateAdapter = adapter('candidate-host-adapter');
const reviewed = loadReviewedFixture();

function resultBody(reviewedCase) {
  return {
    workflow_outcome: reviewedCase.expected.workflow_outcome,
    selected_workflow_ids: clone(reviewedCase.expected.selected_workflow_ids),
    workflow_ranking: reviewedCase.expected.workflow_ranking.map(({ id }) => ({ id })),
    source_ranking: reviewedCase.expected.source_ranking.map(({ path, symbol }) => ({ path, symbol })),
    observations: clone(reviewedCase.expected.observations),
    obligations: clone(reviewedCase.expected.obligations),
    repository_state: clone(reviewedCase.expected.repository_state),
  };
}

function probeEvidence(publicBatch) {
  const observed = brownfieldSignals(
    publicBatch.persona_probe.path,
    Buffer.from(publicBatch.persona_probe.content, 'utf8'),
  );
  const observations = observed.categories.map((category) => ({
    category, path: publicBatch.persona_probe.path,
  }));
  return {
    schema: PERSONA_PROBE_EVIDENCE_SCHEMA,
    input_sha256: publicBatch.persona_probe.content_sha256,
    observations,
    observations_sha256: digest(observations),
  };
}

function rawArtifact(plan, slot, expectedAdapter, transform = (value) => value) {
  const cases = new Map(reviewed.fixture.cases.map((item) => [item.id, item]));
  return transform({
    schema: CANDIDATE_RAW_SCHEMA,
    public_input_sha256: slot.public_batch.public_input_sha256,
    adapter: clone(expectedAdapter),
    persona_probe: probeEvidence(slot.public_batch),
    rows: slot.private_rows.map((privateRow) => ({
      nonce: privateRow.nonce,
      order: privateRow.order,
      result: resultBody(cases.get(privateRow.case_id)),
    })),
  }, { plan, slot });
}

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
    cleanup_verified: true,
    ...overrides,
  };
}

function recordsFor(plan, expectedAdapter, transform = (value) => value, label = expectedAdapter.id) {
  return plan.slots.flatMap((slot) => ['first', 'replay'].map((phase) => {
    const raw = rawArtifact(plan, slot, expectedAdapter, (value, context) =>
      transform(value, { ...context, phase }));
    const handle = `lease-${label}-${slot.slot_id}-${phase}`;
    return {
      slot_id: slot.slot_id,
      phase,
      raw_bytes: serializeCandidateRawArtifact(raw, slot.public_batch, expectedAdapter),
      lease: issueHostLeaseEvidence(plan, leaseFields(plan, slot, phase, handle)),
    };
  }));
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
assert.equal(new Set(plan.slots.flatMap((slot) => slot.private_rows.map((row) => row.nonce))).size, 24);
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

const perfectRecords = recordsFor(plan, currentAdapter);
assert.equal(perfectRecords.length, 12);
assert.equal(new Set(perfectRecords.map((record) => record.lease.opaque_handle)).size, 12);
const perfect = gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter, records: perfectRecords,
});
assert.equal(perfect.result.cases.length, 24);
assert.equal(perfect.result.materializations.length, 24);
assert.deepEqual(perfect.result.cases.map((item) => item.id), reviewed.fixture.cases
  .filter((item) => item.collection_id === plan.collection_id).map((item) => item.id));
assert.equal(perfect.grade.passed, true, JSON.stringify(perfect.grade.diagnostics));
assert.equal(perfect.grade.classification, 'pass');
const tierCaseIds = new Set(reviewed.fixture.cases
  .filter((item) => item.collection_id === plan.collection_id).map((item) => item.id));
const tierMutations = reviewed.fixture.mutations.filter((item) => tierCaseIds.has(item.case_id));
assert.equal(perfect.mutations.registered, tierMutations.length);
assert.equal(perfect.mutations.detected, tierMutations.length);
for (const evidence of perfect.mutations.records) {
  assert.equal(evidence.classification === 'pass', false);
  for (const diagnostic of evidence.diagnostic_includes) {
    assert.ok(evidence.diagnostics.some((actual) => actual.includes(diagnostic)));
  }
}
let allTierMutationCount = perfect.mutations.detected;
for (const tier of ['medium', 'large']) {
  const tierPlan = createCandidateTierPlan(tier);
  const tierAdapter = adapter(`${tier}-host-adapter`);
  const tierGrade = gradeCandidateTierRuns({
    plan: tierPlan,
    expected_adapter: tierAdapter,
    records: recordsFor(tierPlan, tierAdapter),
  });
  assert.equal(tierGrade.result.cases.length, 24);
  assert.equal(tierGrade.grade.passed, true, JSON.stringify(tierGrade.grade.diagnostics));
  assert.equal(tierGrade.mutations.registered, tierGrade.mutations.detected);
  for (const evidence of tierGrade.mutations.records) {
    for (const diagnostic of evidence.diagnostic_includes) {
      assert.ok(evidence.diagnostics.some((actual) => actual.includes(diagnostic)));
    }
  }
  allTierMutationCount += tierGrade.mutations.detected;
}
assert.equal(reviewed.fixture.mutations.length, 31);
assert.equal(allTierMutationCount, reviewed.fixture.mutations.length,
  'all 31 reviewed mutations are detected without rerunning candidate logic');
assert.equal(gradeResult(reviewed.fixture, rawArtifact(plan, plan.slots[0], currentAdapter)).passed, false,
  'a candidate raw artifact alone is not a gradeable normalized Result');
assert.throws(() => gradeCandidateTierRuns({
  plan: clone(plan), expected_adapter: currentAdapter, records: perfectRecords,
}), /plan was not issued/);
assert.throws(() => issueHostLeaseEvidence(plan, leaseFields(
  plan, plan.slots[0], 'first', perfectRecords[0].lease.opaque_handle,
)), /already issued for this plan/,
'a candidate-side launch cannot reuse a handle already issued to the current side');
assert.throws(() => gradeCandidateSideBySide({
  plan,
  current: { adapter: currentAdapter, records: perfectRecords },
  candidate: { adapter: currentAdapter, records: perfectRecords },
}), /side-by-side current and candidate reused a lease handle/);

const candidateRecords = recordsFor(plan, candidateAdapter);
assert.equal(new Set([...perfectRecords, ...candidateRecords]
  .map((record) => record.lease.opaque_handle)).size, 24);
const sideBySide = gradeCandidateSideBySide({
  plan,
  current: { adapter: currentAdapter, records: perfectRecords },
  candidate: { adapter: candidateAdapter, records: candidateRecords },
});
assert.equal(sideBySide.current.grade.passed, true);
assert.equal(sideBySide.candidate.grade.passed, true);
assert.notEqual(sideBySide.current.result.adapter.id, sideBySide.candidate.result.adapter.id);
assert.deepEqual(sideBySide.public_input_sha256,
  plan.slots.map((slot) => slot.public_batch.public_input_sha256));
assert.deepEqual(sideBySide.scenario_digests, plan.slots.map((slot) => slot.scenario_digest));
assert.deepEqual(sideBySide.base_digests, plan.slots.map((slot) => slot.base_digest));

const regressedCandidateRecords = recordsFor(plan, candidateAdapter, (raw, { slot }) => {
  if (slot.slot_id === 'slot-1') {
    raw.rows[0].result.selected_workflow_ids = ['small.profile-entry'];
    raw.rows[0].result.workflow_ranking = [{ id: 'small.profile-entry' }];
  }
  return raw;
}, 'candidate-regression');
const differentResults = gradeCandidateSideBySide({
  plan,
  current: { adapter: currentAdapter, records: perfectRecords },
  candidate: { adapter: candidateAdapter, records: regressedCandidateRecords },
});
assert.equal(differentResults.current.grade.passed, true);
assert.equal(differentResults.candidate.grade.passed, false);
assert.equal(differentResults.candidate.grade.classification, 'product_regression');
assert.deepEqual(differentResults.public_input_sha256, sideBySide.public_input_sha256);
assert.deepEqual(differentResults.base_digests, sideBySide.base_digests);

function rawFromRecord(record) {
  return JSON.parse(record.raw_bytes.toString('utf8'));
}

function replaceRaw(records, index, mutate) {
  const output = [...records];
  const raw = rawFromRecord(output[index]);
  mutate(raw, output[index]);
  output[index] = { ...output[index], raw_bytes: canonicalBytes(raw) };
  return output;
}

assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter, records: perfectRecords.slice(0, -1),
}), /exactly cover/);
assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter, records: [...perfectRecords, perfectRecords[0]],
}), /exactly cover/);
assert.throws(() => gradeCandidateTierRuns({
  plan,
  expected_adapter: currentAdapter,
  records: [perfectRecords[1], perfectRecords[0], ...perfectRecords.slice(2)],
}), /reordered or miscorrelated/);
assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter, records: [...perfectRecords.slice(0, -1), perfectRecords[0]],
}), /duplicate run record|lease handle|reordered or miscorrelated/);
assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter,
  records: replaceRaw(perfectRecords, 0, (raw) => raw.rows.reverse()),
}), /correlated and ordered/);
assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter,
  records: replaceRaw(perfectRecords, 0, (raw) => { raw.public_input_sha256 = '0'.repeat(64); }),
}), /exact public input/);
assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter,
  records: replaceRaw(perfectRecords, 0, (raw) => { raw.case_id = 'candidate-private-id'; }),
}), /private controller key|unexpected/);
assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter,
  records: replaceRaw(perfectRecords, 0, (raw) => { raw.adapter.id = candidateAdapter.id; }),
}), /host-expected implementation/);
assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter,
  records: replaceRaw(perfectRecords, 0, (raw) => {
    raw.persona_probe.observations = [{ category: 'personas', path: plan.slots[0].public_batch.persona_probe.path }];
    raw.persona_probe.observations_sha256 = digest(raw.persona_probe.observations);
  }),
}), /independently recomputed production evidence/);

const fakeLeaseRecords = [...perfectRecords];
fakeLeaseRecords[0] = { ...fakeLeaseRecords[0], lease: clone(fakeLeaseRecords[0].lease) };
assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter, records: fakeLeaseRecords,
}), /not issued by the host/);

const otherPlan = createCandidateTierPlan('small');
const otherPlanRecords = recordsFor(otherPlan, currentAdapter, (raw) => raw, 'other-plan');
otherPlanRecords[0] = { ...otherPlanRecords[0], lease: perfectRecords[0].lease };
assert.throws(() => gradeCandidateTierRuns({
  plan: otherPlan, expected_adapter: currentAdapter, records: otherPlanRecords,
}), /issued for different host authority/,
'lease evidence cannot be transplanted between same-tier issued plans');

const mismatchRecords = [...perfectRecords];
mismatchRecords[0] = {
  ...mismatchRecords[0],
  lease: issueHostLeaseEvidence(plan, leaseFields(
    plan, plan.slots[0], 'first', 'lease-mismatched-digest-0001', { end_digest: 'f'.repeat(64) },
  )),
};
assert.throws(() => gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter, records: mismatchRecords,
}), /lease end_digest differs/);

const replayDivergence = replaceRaw(perfectRecords, 1, (raw) => {
  raw.rows[0].result.selected_workflow_ids = ['small.profile-entry'];
  raw.rows[0].result.workflow_ranking = [{ id: 'small.profile-entry' }];
});
const divergent = gradeCandidateTierRuns({
  plan, expected_adapter: currentAdapter, records: replayDivergence,
});
assert.equal(divergent.grade.passed, false);
assert.equal(divergent.grade.classification, 'product_regression');
assert.ok(divergent.grade.diagnostics.some((item) => item.includes('deterministic ordering')));

console.log('real repository oracle private candidate grade controller passed');
