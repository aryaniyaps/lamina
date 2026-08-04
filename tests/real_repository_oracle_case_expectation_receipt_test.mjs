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
  RECEIPT_SEMANTIC_CASE_MAPPING_CANONICAL_SHA256,
  loadCaseExpectationReview,
  parseCaseExpectationReviewBytes,
  semanticMappingReceiptMatches,
  validateCaseExpectationReview,
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
  WORKFLOW_SEED_CANONICAL_SHA256, WORKFLOW_SEED_RAW_SHA256, loadWorkflowSeed,
} from '../benchmarks/real-repository-oracle-v1/workflow-seed.mjs';
import {
  INDEPENDENT_LEXICAL_WITNESS_AUTHORITY,
  SEMANTIC_CASE_MAPPING, SEMANTIC_CASE_MAPPING_CANONICAL_SHA256,
  semanticCaseMappingDigest, validateSemanticCaseMapping,
} from '../benchmarks/real-repository-oracle-v1/semantic-case-authority.mjs';
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
assert.equal(CASE_EXPECTATIONS_RAW_SHA256,
  'e08f5501a1d3b70c4304bcbf5607e32547dcc04a03a53c93349ef2407ed1ed79');
assert.equal(CASE_EXPECTATIONS_CANONICAL_SHA256,
  '392191168e754aa5ae5f07c782545cfc165df08328ebd6ba2fd9415f3b6487e8');
assert.equal(sha256(bytes), CASE_EXPECTATIONS_RAW_SHA256);
assert.equal(fixtureDigest(fixture), CASE_EXPECTATIONS_CANONICAL_SHA256);
assert.equal(fixture.cases.length, 72);
assert.equal(fixture.mutations.length, 31);
assert.deepEqual(CASE_EXPECTATION_REVIEW_AUTHORITY.counts,
  { tiers: 3, cases: 72, identity: 30, semantic_source: 24, state: 18, mutations: 31 });
assert.equal(CASE_EXPECTATION_REVIEW_AUTHORITY.review_status,
  'accepted_independent_review_adjudication');
assert.equal(CASE_EXPECTATION_REVIEW_AUTHORITY.review_decision, 'accepted');

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
assert.equal(CASE_EXPECTATION_REVIEW_AUTHORITY.semantic_case_mapping_canonical_sha256,
  RECEIPT_SEMANTIC_CASE_MAPPING_CANONICAL_SHA256);
assert.equal(RECEIPT_SEMANTIC_CASE_MAPPING_CANONICAL_SHA256,
  SEMANTIC_CASE_MAPPING_CANONICAL_SHA256);
assert.equal(semanticCaseMappingDigest(), SEMANTIC_CASE_MAPPING_CANONICAL_SHA256);
assert.equal(semanticMappingReceiptMatches(), true);
assert.equal(semanticMappingReceiptMatches('0'.repeat(64)), false,
  'receipt-owned literal rejects a mapping digest mismatch through a non-tautological seam');
assert.deepEqual(validateSemanticCaseMapping(SEMANTIC_CASE_MAPPING), { valid: true, errors: [] });

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

const seed = loadWorkflowSeed().seed;
const seedWorkflows = seed.collections.flatMap((collection) => collection.workflows);
const seedWorkflowById = new Map(seedWorkflows.map((workflow) => [workflow.id, workflow]));
assert.deepEqual(
  fixture.cases.filter((item) => item.id.includes('.semantic.')).map((item) => item.id),
  SEMANTIC_CASE_MAPPING.rows.map((item) => item.id),
  'all 42 semantic rows exactly match mapping authority order',
);
for (const mapping of SEMANTIC_CASE_MAPPING.rows) {
  const reviewedCase = fixture.cases.find((item) => item.id === mapping.id);
  const tier = mapping.id.split('.')[0];
  for (const workflowId of mapping.workflow_ids) {
    assert.equal(seedWorkflowById.get(workflowId)?.id.startsWith(`${tier}.`), true,
      `${mapping.id} Workflow is owned by the same tier`);
  }
  const expectedSurfaces = mapping.source_surface_ids.map((surfaceId) => {
    const owners = seedWorkflows.filter((workflow) => workflow.surfaces.some((surface) => surface.id === surfaceId));
    assert.equal(owners.length, 1, `${mapping.id} surface has one public-seed owner`);
    assert.ok(mapping.workflow_ids.includes(owners[0].id), `${mapping.id} surface belongs to a mapped Workflow`);
    return owners[0].surfaces.find((surface) => surface.id === surfaceId);
  });
  assert.deepEqual(reviewedCase.expected.source_ranking.slice(0, expectedSurfaces.length)
    .map(({ path, symbol }) => ({ path, symbol })),
  expectedSurfaces.map(({ path, symbol }) => ({ path, symbol })), `${mapping.id} ranks exact surfaces in order`);
  assert.equal(reviewedCase.rationale, mapping.rationale);
}
assert.deepEqual(SEMANTIC_CASE_MAPPING.rows.filter((item) => item.separate_lexical_category)
  .map((item) => [item.id, item.separate_lexical_category]), Object.entries(
  INDEPENDENT_LEXICAL_WITNESS_AUTHORITY,
));
for (const [id, category] of Object.entries(INDEPENDENT_LEXICAL_WITNESS_AUTHORITY)) {
  const item = fixture.cases.find((candidate) => candidate.id === id);
  const tier = id.split('.')[0];
  const witness = OBSERVATION_CATEGORY_SUPPORT[tier].positive_targets.find((target) =>
    target.category === category);
  assert.deepEqual(item.expected.source_ranking.at(-1), {
    path: witness.path, symbol: witness.symbol || null,
    max_rank: item.expected.source_ranking.length,
  });
  assert.match(item.request, new RegExp(`Separately localize the exact reviewed ${category} witness`));
  assert.match(item.request, /independent lexical evidence and must not be attached/);
}
assert.deepEqual(fixture.cases.find((item) => item.id === 'small.semantic.13-test')
  .expected.source_ranking[0], {
  path: 'apps/nextjs-app/src/lib/__tests__/authorization.test.tsx', symbol: 'Authorization', max_rank: 1,
});
assert.deepEqual(fixture.cases.find((item) => item.id === 'medium.semantic.11-test')
  .expected.source_ranking[0], {
  path: 'plugins/oidc/server/oidcDiscovery.test.ts', symbol: 'DefaultBodyType', max_rank: 1,
});
assert.deepEqual(fixture.cases.find((item) => item.id === 'large.semantic.09-docs_persona')
  .expected.source_ranking[0], {
  path: 'packages/decorators/README.md', symbol: 'UserController', max_rank: 1,
});

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

function rejectsReview(mutator, pattern, message) {
  const value = structuredClone(fixture);
  mutator(value);
  const validation = validateCaseExpectationReview(value);
  assert.equal(validation.valid, false, message);
  assert.match(validation.errors.join('; '), pattern, message);
}

for (const [index, mapping] of SEMANTIC_CASE_MAPPING.rows.entries()) {
  rejectsReview((value) => {
    const item = value.cases.find((candidate) => candidate.id === mapping.id);
    if (item.expected.source_ranking.length) {
      item.expected.source_ranking[0].path = `semantic-tamper/row-${index + 1}.ts`;
    } else {
      item.expected.source_ranking.push({
        path: `semantic-tamper/row-${index + 1}.ts`, symbol: null, max_rank: 1,
      });
    }
  }, /exact ordered semantic surface authority/, `${mapping.id} source binding tamper`);
}

rejectsReview((value) => {
  const item = value.cases.find((candidate) => candidate.id === 'small.semantic.06-permission');
  item.expected.selected_workflow_ids = ['small.route-completion'];
  item.expected.workflow_ranking = [{ id: 'small.route-completion', max_rank: 1 }];
  item.expected.source_ranking = [{
    path: 'apps/nextjs-pages/src/components/layouts/dashboard-layout.tsx',
    symbol: 'routeChangeComplete', max_rank: 1,
  }];
}, /exact semantic mapping|exact ordered semantic surface authority/, 'Workflow/surface pair swap');
rejectsReview((value) => {
  const item = value.cases.find((candidate) => candidate.id === 'small.semantic.06-permission');
  item.expected.selected_workflow_ids = ['medium.api-key-actions'];
  item.expected.workflow_ranking = [{ id: 'medium.api-key-actions', max_rank: 1 }];
}, /exact semantic mapping/, 'cross-tier Workflow ownership swap');
rejectsReview((value) => {
  const item = value.cases.find((candidate) => candidate.id === 'large.semantic.04-docs_persona');
  const [first, second] = item.expected.source_ranking;
  item.expected.source_ranking = [
    { ...second, max_rank: 1 }, { ...first, max_rank: 2 },
  ];
}, /exact ordered semantic surface authority/, 'semantic surface rank order');
rejectsReview((value) => {
  const item = value.cases.find((candidate) => candidate.id === 'small.semantic.13-test');
  item.expected.source_ranking.push({
    path: 'apps/nextjs-app/src/testing/test-utils.tsx', symbol: null, max_rank: 2,
  });
}, /exact ordered semantic surface authority/, 'extra observation-category witness');
rejectsReview((value) => {
  const item = value.cases.find((candidate) => candidate.id === 'medium.semantic.08-flag');
  item.expected.source_ranking.reverse();
  item.expected.source_ranking.forEach((target, index) => { target.max_rank = index + 1; });
}, /exact ordered semantic surface authority/, 'separate lexical witness cannot become rank one');
rejectsReview((value) => {
  const item = value.cases.find((candidate) => candidate.id === 'large.semantic.09-docs_persona');
  item.rationale = 'A long but invented rationale that is not the sealed semantic mapping authority.';
}, /rationale differs from its exact semantic mapping authority/, 'semantic rationale seal');

const obligationCases = fixture.cases.filter((item) => item.expected.obligations.length);
assert.deepEqual(obligationCases.map((item) => item.id), [
  'small.semantic.06-permission', 'medium.semantic.03-entity', 'large.semantic.09-docs_persona',
]);
assert.deepEqual(obligationCases.map((item) => item.expected.obligations.map((target) => target.category)), [
  ['implementation', 'state', 'permission', 'failure', 'persona', 'completeness', 'verification'],
  ['implementation', 'state', 'permission', 'failure', 'persona', 'completeness', 'verification'],
  ['implementation', 'state', 'permission', 'failure', 'persona', 'completeness', 'verification'],
]);
for (const category of ['implementation', 'state', 'permission', 'failure', 'persona', 'completeness', 'verification']) {
  rejectsReview((value) => {
    const item = value.cases.find((candidate) => candidate.id === 'small.semantic.06-permission');
    item.expected.obligations.find((target) => target.category === category).relation += ':tampered';
  }, /obligations differ from exact public-seed contract derivation/, `${category} obligation relation`);
  rejectsReview((value) => {
    const item = value.cases.find((candidate) => candidate.id === 'medium.semantic.03-entity');
    item.expected.obligations.find((target) => target.category === category).id += '.tampered';
  }, /obligations differ from exact public-seed contract derivation/, `${category} obligation id`);
}

const invalidSeparateMapping = structuredClone(SEMANTIC_CASE_MAPPING);
invalidSeparateMapping.rows.find((item) => item.id === 'small.semantic.12-transition')
  .separate_lexical_category = 'feature_flags';
assert.match(validateSemanticCaseMapping(invalidSeparateMapping).errors.join('; '),
  /exactly match the reviewed row-to-category authority/);
const unknownMappingRootKey = structuredClone(SEMANTIC_CASE_MAPPING);
unknownMappingRootKey.unexpected = true;
assert.match(validateSemanticCaseMapping(unknownMappingRootKey).errors.join('; '),
  /mapping root/);
const unknownMappingRowKey = structuredClone(SEMANTIC_CASE_MAPPING);
unknownMappingRowKey.rows[0].unexpected = true;
assert.match(validateSemanticCaseMapping(unknownMappingRowKey).errors.join('; '),
  /mapping row is malformed/);

for (const [id, category] of [
  ['small.semantic.13-test', 'tests'],
  ['medium.semantic.11-test', 'tests'],
  ['large.semantic.09-docs_persona', 'documentation'],
]) {
  const tier = id.split('.')[0];
  const falseWitness = OBSERVATION_CATEGORY_SUPPORT[tier].positive_targets.find((target) =>
    target.category === category);
  const falseJoin = structuredClone(fixture);
  const item = falseJoin.cases.find((candidate) => candidate.id === id);
  item.expected.source_ranking[0] = {
    path: falseWitness.path, symbol: falseWitness.symbol || null, max_rank: 1,
  };
  const validation = validateCaseExpectationReview(falseJoin);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('; '), /exact ordered semantic surface authority/);
  assert.throws(() => parseCaseExpectationReviewBytes(
    Buffer.from(JSON.stringify(falseJoin)), { requireReviewedBytes: false },
  ), /case expectation review is invalid/,
  `${id} d575e8-style false join remains rejected when raw-byte identity is disabled`);
}

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
assert.equal(FIXTURE_AUTHORITY_BOUNDARY.candidate_closure,
  'public_batch_and_single_run_raw_exclude_private_fixture_expectation_scenario_and_grade_authority');
assert.equal(FIXTURE_AUTHORITY_BOUNDARY.persona_positive_capability_gate,
  'host_recomputed_fixed_probe_contract_pending_isolated_candidate_execution');
assert.equal(FIXTURE_AUTHORITY_BOUNDARY.quality_pass,
  'oracle_validation_host_reconstruction_reachable_without_measured_runtime_or_safety_claims');

const workflowSeedSource = fs.readFileSync(new URL(
  '../benchmarks/real-repository-oracle-v1/workflow-seed.mjs', import.meta.url,
), 'utf8');
assert.doesNotMatch(workflowSeedSource, /case-expectation|fixture-authority|reviews\/case/,
  'candidate-visible Workflow seed must not import private expectation authority');
const readme = fs.readFileSync(new URL(
  '../benchmarks/real-repository-oracle-v1/README.md', import.meta.url,
), 'utf8');
assert.doesNotMatch(readme, /pending[^.\n]{0,80}receipt|receipt[^.\n]{0,80}pending/i,
  'accepted receipt documentation must not retain contradictory pending wording');
assert.throws(() => parseCaseExpectationReviewBytes(Buffer.alloc(256 * 1024 + 1)), /private reviewed identity/);
const changedBytes = Buffer.from(bytes);
changedBytes[changedBytes.length - 2] = changedBytes[changedBytes.length - 2] === 10 ? 32 : 10;
assert.throws(() => parseCaseExpectationReviewBytes(changedBytes), /private reviewed identity/);

console.log('real repository oracle private case expectation receipt contracts passed');
