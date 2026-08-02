#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CASE_EXPECTATIONS_CANONICAL_SHA256,
  CASE_EXPECTATIONS_RAW_SHA256,
  CASE_EXPECTATION_REVIEW_AUTHORITY,
  loadCaseExpectationReview,
  parseCaseExpectationReviewBytes,
} from '../benchmarks/real-repository-oracle-v1/case-expectation-review-receipt.mjs';
import {
  FIXTURE_AUTHORITY_BOUNDARY, loadReviewedFixture,
} from '../benchmarks/real-repository-oracle-v1/fixture-authority.mjs';
import {
  OBSERVATION_CATEGORY_SUPPORT,
  OBSERVATION_CATEGORY_SUPPORT_CANONICAL_SHA256,
  OBSERVATION_CATEGORY_SUPPORT_RAW_SHA256,
} from '../benchmarks/real-repository-oracle-v1/observation-category-authority.mjs';
import {
  SCENARIO_SELECTION_CANONICAL_SHA256, SCENARIO_SELECTION_RAW_SHA256,
} from '../benchmarks/real-repository-oracle-v1/scenario-selection.mjs';
import {
  WORKFLOW_SEED_CANONICAL_SHA256, WORKFLOW_SEED_RAW_SHA256,
} from '../benchmarks/real-repository-oracle-v1/workflow-seed.mjs';
import {
  ADAPTER_SCHEMA, RESULT_SCHEMA, canonical, digest, executeRegisteredMutation, fixtureDigest,
  materializationBaseDigest, materializationProvenanceDigest, resultCasesDigest, validateResult,
} from '../benchmarks/real-repository-oracle-v1/contract.mjs';
import { gradeResult } from '../benchmarks/real-repository-oracle-v1/grade.mjs';

const reviewFile = new URL(
  '../benchmarks/real-repository-oracle-v1/reviews/case-expectations-v1.json', import.meta.url,
);
const bytes = fs.readFileSync(reviewFile);
const regeneratedBytes = execFileSync(process.execPath, [fileURLToPath(new URL(
  '../benchmarks/real-repository-oracle-v1/author-case-expectations.mjs', import.meta.url,
))], { maxBuffer: 512 * 1024 });
assert.deepEqual(regeneratedBytes, bytes, 'authoring projection reproduces the frozen review byte-for-byte');
const loaded = loadCaseExpectationReview();
const fixture = loaded.fixture;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sectionDigest = (value) => sha256(JSON.stringify(canonical(value)));
const stateRow = (item) => item.kind.intent === 'new_workflow' || item.kind.intent === 'adversarial'
  || ['rename', 'delete', 'checkout_branch', 'add_worktree']
    .includes(item.repository_scenario.operations[0]?.op);

assert.equal(loaded.raw_sha256, CASE_EXPECTATIONS_RAW_SHA256);
assert.equal(loaded.canonical_sha256, CASE_EXPECTATIONS_CANONICAL_SHA256);
assert.equal(sha256(bytes), CASE_EXPECTATIONS_RAW_SHA256);
assert.equal(fixtureDigest(fixture), CASE_EXPECTATIONS_CANONICAL_SHA256);
assert.equal(fixture.cases.length, 72);
assert.equal(fixture.mutations.length, 31);
assert.deepEqual(CASE_EXPECTATION_REVIEW_AUTHORITY.counts,
  { tiers: 3, cases: 72, identity: 30, semantic_source: 24, state: 18, mutations: 31 });

const sectionValues = {
  collections_sha256: fixture.collections,
  request_scenario_set_sha256: fixture.cases.map(
    ({ id, collection_id, request, kind, repository_scenario }) =>
      ({ id, collection_id, request, kind, repository_scenario }),
  ),
  expectation_set_sha256: fixture.cases.map(
    ({ id, expected, rationale }) => ({ id, expected, rationale }),
  ),
  mutation_set_sha256: fixture.mutations,
  gates_sha256: {
    qualified_current: fixture.held_out_compatibility.qualified_current,
    thresholds: fixture.held_out_compatibility.thresholds,
  },
  held_out_identity_sha256: fixture.held_out_compatibility,
};
for (const [field, value] of Object.entries(sectionValues)) {
  assert.equal(sectionDigest(value), CASE_EXPECTATION_REVIEW_AUTHORITY[field], `${field} is independently sealed`);
}
assert.equal(CASE_EXPECTATION_REVIEW_AUTHORITY.workflow_seed_raw_sha256, WORKFLOW_SEED_RAW_SHA256);
assert.equal(CASE_EXPECTATION_REVIEW_AUTHORITY.workflow_seed_canonical_sha256, WORKFLOW_SEED_CANONICAL_SHA256);
assert.equal(CASE_EXPECTATION_REVIEW_AUTHORITY.observation_support_raw_sha256,
  OBSERVATION_CATEGORY_SUPPORT_RAW_SHA256);
assert.equal(CASE_EXPECTATION_REVIEW_AUTHORITY.observation_support_canonical_sha256,
  OBSERVATION_CATEGORY_SUPPORT_CANONICAL_SHA256);
assert.equal(CASE_EXPECTATION_REVIEW_AUTHORITY.scenario_selection_raw_sha256,
  SCENARIO_SELECTION_RAW_SHA256);
assert.equal(CASE_EXPECTATION_REVIEW_AUTHORITY.scenario_selection_canonical_sha256,
  SCENARIO_SELECTION_CANONICAL_SHA256);

const tiers = ['small', 'medium', 'large'];
for (const tier of tiers) {
  const cases = fixture.cases.filter((item) => item.collection_id === `collection.${tier}`);
  const identity = cases.filter((item) => item.id.includes('.identity.'));
  const state = cases.filter((item) => item.id.includes('.semantic.') && stateRow(item));
  assert.deepEqual([cases.length, identity.length, cases.length - identity.length - state.length, state.length],
    [24, 10, 8, 6]);
  assert.equal(cases.filter((item) => item.kind.intent === 'ambiguous_workflow').length, 1);
}
assert.equal(fixture.cases.filter((item) => item.id.includes('.identity.')).length, 30);
assert.equal(fixture.cases.filter(stateRow).length, 18);

const queryCounts = fixture.cases.reduce((counts, item) => {
  counts[item.kind.query] = (counts[item.kind.query] || 0) + 1;
  return counts;
}, {});
assert.equal(queryCounts.exact_workflow_id, 15);
assert.equal(queryCounts.exact_workflow_alias, 15);
assert.equal(queryCounts.persona, 3);
assert.equal(queryCounts.permission, 3);
for (const [query, count] of Object.entries(queryCounts)) {
  if (!query.startsWith('exact_workflow_')) assert.ok(count >= 2, `${query} has at least two reviewed cases`);
}

for (const item of fixture.cases) {
  const selected = item.expected.selected_workflow_ids.length;
  if (item.expected.workflow_outcome === 'selected') assert.equal(selected, 1);
  if (item.expected.workflow_outcome === 'multi_workflow') assert.ok(selected >= 2);
  if (['ambiguous', 'new_workflow_required'].includes(item.expected.workflow_outcome)) assert.equal(selected, 0);
  const digestLeak = (value) => value && typeof value === 'object'
    && (Object.keys(value).some((key) => key.endsWith('_sha256'))
      || Object.values(value).some(digestLeak));
  assert.equal(digestLeak(item), false, `${item.id} has no answer-label digest`);
}
for (const item of fixture.cases.filter((candidate) => candidate.kind.scope === 'multi_file')) {
  assert.ok(item.expected.selected_workflow_ids.length >= 2);
  assert.ok(new Set(item.expected.source_ranking.map((target) => target.path)).size >= 2);
}

const unexpected = fixture.mutations.filter((item) => item.kind === 'unexpected_observation');
const unexpectedModes = unexpected.map((mutation) => {
  const reviewedCase = fixture.cases.find((item) => item.id === mutation.case_id);
  const tier = reviewedCase.collection_id.replace('collection.', '');
  const category = reviewedCase.expected.forbidden_observations[0].category;
  return `${category}:${OBSERVATION_CATEGORY_SUPPORT[tier].reviewed_absent[category].mode}`;
}).sort();
assert.deepEqual(unexpectedModes, [
  'handlers:bounded_negative_controls',
  'personas:complete_candidate_set_absence',
  'personas:complete_candidate_set_absence',
  'personas:complete_candidate_set_absence',
]);

function rejects(mutator, message) {
  const value = structuredClone(fixture);
  mutator(value);
  assert.throws(
    () => parseCaseExpectationReviewBytes(Buffer.from(JSON.stringify(value)), { requireReviewedBytes: false }),
    /case expectation review is invalid/,
    message,
  );
}
rejects((value) => { value.collections[0].observation_candidate_files += 1; }, 'collection seal tamper');
rejects((value) => { value.cases[0].request += ' changed'; }, 'request/scenario seal tamper');
rejects((value) => { value.cases[0].repository_scenario.name += '-tamper'; }, 'scenario seal tamper');
rejects((value) => { value.cases[0].rationale += ' changed'; }, 'expectation/rationale seal tamper');
rejects((value) => { value.mutations[0].diagnostic_includes[0] += ' changed'; }, 'mutation seal tamper');
rejects((value) => { value.held_out_compatibility.thresholds.workflow_recall_at_5 = 0.98; }, 'gate seal tamper');
rejects((value) => { value.held_out_compatibility.workflow_rows = 159; }, 'held-out identity tamper');
rejects((value) => {
  const observationCase = value.cases.find((item) => item.expected.observations.length);
  observationCase.expected.observations[0].path = 'invented/fake-persona.ts';
}, 'positive witness path tamper');
rejects((value) => {
  const controlCase = value.cases.find((item) => item.expected.forbidden_observations.length);
  controlCase.expected.forbidden_observations[0].symbol = 'inventedExtra';
}, 'reviewed absence control must have exact keys');
rejects((value) => { value.cases[0].answer_sha256 = '0'.repeat(64); }, 'per-case digest key leak');
rejects((value) => {
  const item = value.cases.find((candidate) => candidate.kind.intent === 'ambiguous_workflow');
  const tierCases = value.cases.filter((candidate) => candidate.collection_id === item.collection_id);
  item.expected.forbidden_workflow_ids[0] = tierCases.find((candidate) =>
    candidate.expected.selected_workflow_ids.length
      && !item.expected.forbidden_workflow_ids.includes(candidate.expected.selected_workflow_ids[0]))
    .expected.selected_workflow_ids[0];
}, 'ambiguous alternatives must match the request');
rejects((value) => {
  const item = value.cases.find((candidate) => candidate.repository_scenario.operations[0]?.op === 'rename');
  item.request = item.request.replace('unrelated', 'changed');
}, 'rename prose cannot imply that the expected source moved');
rejects((value) => {
  const item = value.cases.find((candidate) => candidate.repository_scenario.operations[0]?.op === 'add_worktree');
  item.request = item.request.replace(item.expected.source_ranking[0].path, 'unreviewed/evidence.ts');
}, 'worktree prompt must name its exact query witness');

function idealResult(tier) {
  const collection = fixture.collections.find((item) => item.fixture_id === tier);
  const reviewedCases = fixture.cases.filter((item) => item.collection_id === collection.id);
  const cases = reviewedCases.map((item) => ({
    id: item.id,
    workflow_outcome: item.expected.workflow_outcome,
    selected_workflow_ids: [...item.expected.selected_workflow_ids],
    workflow_ranking: item.expected.workflow_ranking.map(({ id }) => ({ id })),
    source_ranking: item.expected.source_ranking.map(({ path, symbol }) => ({ path, symbol })),
    observations: structuredClone(item.expected.observations),
    obligations: structuredClone(item.expected.obligations),
    repository_state: structuredClone(item.expected.repository_state),
  }));
  const materializations = reviewedCases.map((item) => {
    const scenarioDigest = digest(item.repository_scenario);
    const provenanceDigest = materializationProvenanceDigest(collection, scenarioDigest);
    const baseDigest = materializationBaseDigest(collection, scenarioDigest);
    return {
      case_id: item.id, repository_url: collection.repository_url,
      resolved_commit: collection.commit, tree_oid: collection.tree_oid,
      candidate_policy_sha256: collection.candidate_policy_sha256,
      scenario_digest: scenarioDigest, provenance_digest: provenanceDigest, base_digest: baseDigest,
      first_start_digest: baseDigest, first_end_digest: baseDigest,
      replay_start_digest: baseDigest, replay_end_digest: baseDigest,
    };
  });
  return {
    schema: RESULT_SCHEMA,
    adapter: {
      schema: ADAPTER_SCHEMA, id: 'private-receipt-mechanics', version: 1,
      input_format: 'lamina.real-repository-oracle-input/v1',
      output_format: 'lamina.real-repository-oracle-result-case/v1',
    },
    fixture_digest: fixtureDigest(fixture), collection_id: collection.id,
    collection_digest: collection.collection_digest, evidence_mode: 'oracle_validation',
    claims: {
      end_to_end_runtime: false, observation: 'not_measured', obligations: 'not_measured',
      source_localization: 'not_measured',
    },
    safety: { mode: 'not_applicable', outcome: 'not_applicable', reason: null, attestation: null },
    cases, materializations, replay_digest: resultCasesDigest(cases),
  };
}

const idealByTier = new Map();
for (const tier of tiers) {
  const result = idealResult(tier);
  idealByTier.set(tier, result);
  assert.deepEqual(validateResult(result), { valid: true, errors: [] });
  assert.equal(gradeResult(fixture, result).classification, 'pass',
    `${tier} private ideal validates grader mechanics only`);
}
for (const mutation of fixture.mutations) {
  const reviewedCase = fixture.cases.find((item) => item.id === mutation.case_id);
  const tier = reviewedCase.collection_id.replace('collection.', '');
  const mutated = executeRegisteredMutation(fixture, idealByTier.get(tier), mutation);
  assert.deepEqual(validateResult(mutated), { valid: true, errors: [] },
    `${mutation.id} remains result-schema valid`);
  const graded = gradeResult(fixture, mutated);
  assert.equal(graded.classification, 'product_regression', `${mutation.id} must fail mechanically`);
  for (const diagnostic of mutation.diagnostic_includes) {
    assert.ok(graded.diagnostics.some((item) => item.includes(diagnostic)),
      `${mutation.id} must emit focused diagnostic ${diagnostic}`);
  }
}

const first = loadReviewedFixture();
const second = loadReviewedFixture();
first.fixture.cases[0].request = 'controller-local mutation';
assert.notEqual(second.fixture.cases[0].request, first.fixture.cases[0].request);
assert.equal(first.fixture_digest, CASE_EXPECTATIONS_CANONICAL_SHA256);
assert.equal(FIXTURE_AUTHORITY_BOUNDARY.visibility, 'private_controller_only');
assert.equal(FIXTURE_AUTHORITY_BOUNDARY.candidate_supplied_fixture_or_grade_trusted, false);
assert.equal(FIXTURE_AUTHORITY_BOUNDARY.candidate_closure, 'pending_not_implemented_or_reachable');
assert.equal(FIXTURE_AUTHORITY_BOUNDARY.persona_positive_capability_gate,
  'excepted_pending_unimplemented_candidate_facing_sealed_probe');
assert.equal(FIXTURE_AUTHORITY_BOUNDARY.quality_pass,
  'structurally_unreachable_pending_candidate_isolation_and_host_grading');

const workflowSeedSource = fs.readFileSync(new URL(
  '../benchmarks/real-repository-oracle-v1/workflow-seed.mjs', import.meta.url,
), 'utf8');
assert.doesNotMatch(workflowSeedSource, /case-expectation|fixture-authority|reviews\/case/,
  'candidate-visible Workflow seed must not import private expectation authority');
assert.throws(() => parseCaseExpectationReviewBytes(Buffer.alloc(256 * 1024 + 1)), /private reviewed identity/);
const changedBytes = Buffer.from(bytes);
changedBytes[changedBytes.length - 2] = changedBytes[changedBytes.length - 2] === 10 ? 32 : 10;
assert.throws(() => parseCaseExpectationReviewBytes(changedBytes), /private reviewed identity/);

console.log('real repository oracle private case expectation receipt contracts passed');
