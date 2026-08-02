#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  COLLECTION_SCHEMA, FIXTURE_SCHEMA, FROZEN_GATES, OBSERVATION_CATEGORIES,
  OBLIGATION_CATEGORIES, QUALIFIED_CURRENT_BASELINE, REQUIRED_COVERAGE,
  collectionDigest, digest, resultCasesDigest, validateFixture, validateResult,
} from '../benchmarks/real-repository-oracle-v1/contract.mjs';
import {
  adapterInput, evaluateAdapter, evaluateSideBySide, safetyBlockedResult,
} from '../benchmarks/real-repository-oracle-v1/evaluate.mjs';
import { gradeResult } from '../benchmarks/real-repository-oracle-v1/grade.mjs';
import { heldOutIdentity } from '../benchmarks/real-repository-oracle-v1/held-out-compatibility.mjs';
import { parsePorcelainV2Z } from '../benchmarks/real-repository-oracle-v1/repository-state.mjs';
import { retrievalFixture } from '../benchmarks/retrieval-v1/fixtures.mjs';
import {
  validateFixtureSchema, validateResultSchema,
} from '../benchmarks/real-repository-oracle-v1/schema-validation.mjs';

const baselineManifestDigest = '9e8319288d69b77f77f2b3e386c868f83e62a1b7032ca4f3deb443acf60bb3ba';
const pins = [
  ['small', 'https://github.com/alan2207/bulletproof-react.git', '9506629ed003a561c6627735480cce4994244bb4'],
  ['medium', 'https://github.com/outline/outline.git', '30730179b852d42da5078a9294f7d05a44f516b7'],
  ['large', 'https://github.com/makeplane/plane.git', 'dc9d80b2d2a499b967f0b541e083b283f463719f'],
];

function collection([fixtureId, repositoryUrl, commit], index) {
  const value = {
    schema: COLLECTION_SCHEMA,
    id: `collection.${fixtureId}`,
    fixture_id: fixtureId,
    fixture_class: fixtureId,
    repository_url: repositoryUrl,
    commit,
    baseline_manifest_sha256: baselineManifestDigest,
    observation_paths_sha256: String(index + 1).repeat(64),
    observation_candidate_files: 100 + index,
    observation_candidate_bytes: 1000 + index,
    retrieval_paths_sha256: String(index + 4).repeat(64),
    retrieval_candidate_files: 80 + index,
    retrieval_candidate_bytes: 800 + index,
    collection_digest: '',
  };
  value.collection_digest = collectionDigest(value);
  return value;
}

const collections = pins.map(collection);
const observations = OBSERVATION_CATEGORIES.map((category) => ({
  category, path: `src/${category}.ts`,
}));
const obligations = OBLIGATION_CATEGORIES.map((category) => ({
  category, path: `src/${category}.ts`,
}));

function reviewedCase(collectionId, suffix, {
  coverage, outcome, selected, workflowRanking = [], sourceRanking = [],
} = {}) {
  return {
    id: `${collectionId}.${suffix}`,
    collection_id: collectionId,
    request: `Reviewed ${suffix} request for ${collectionId}`,
    coverage,
    repository_scenario: { kind: 'clean', name: 'pinned-clean', operations: [] },
    expected: {
      workflow_outcome: outcome,
      selected_workflow_ids: selected,
      forbidden_workflow_ids: ['workflow.forbidden'],
      workflow_ranking: workflowRanking,
      source_ranking: sourceRanking,
      observations: suffix === 'exact' ? observations : [],
      forbidden_observations: [],
      obligations: suffix === 'exact' ? obligations : [],
      forbidden_paths: [],
      repository_state: { branch: '(detached)', worktree: 'primary', changes: [] },
    },
    rationale: 'Compact reviewed expectation bound to one exact repository collection.',
  };
}

const cases = collections.flatMap((item) => [
  reviewedCase(item.id, 'exact', {
    coverage: REQUIRED_COVERAGE.filter((category) =>
      !['multi_workflow', 'new_workflow'].includes(category)),
    outcome: 'selected', selected: ['workflow.primary'],
    workflowRanking: [{ id: 'workflow.primary', max_rank: 1 }],
    sourceRanking: [{ path: 'src/entry_point.ts', symbol: 'entryPoint', max_rank: 1 }],
  }),
  reviewedCase(item.id, 'multi', {
    coverage: ['multi_workflow'], outcome: 'multi_workflow',
    selected: ['workflow.primary', 'workflow.secondary'],
  }),
  reviewedCase(item.id, 'novel', {
    coverage: ['new_workflow'], outcome: 'new_workflow_required', selected: [],
  }),
]);

const heldOut = heldOutIdentity(retrievalFixture());
assert.deepEqual(heldOut, {
  workflow_rows: 160,
  workflow_rows_bytes: 16928,
  workflow_rows_sha256: '536c7459bb3457ca01b1a5444964bb5cc1d3cea8d7fc3ff5c1c84190f26c9027',
  source_rows: 80,
  source_rows_bytes: 11806,
  source_rows_sha256: '080df00ccec46bf06a7b9336c1defd270a312005e872b1e64f29437e08709f99',
});

const fixture = {
  schema: FIXTURE_SCHEMA,
  id: 'synthetic-contract-fixture',
  version: 1,
  collections,
  cases,
  mutations: [{
    id: 'wrong-workflow', case_id: cases[0].id, kind: 'wrong_workflow',
    diagnostic_includes: ['selected Workflow ids'],
  }],
  held_out_compatibility: {
    benchmark: 'benchmarks/retrieval-v1/benchmark.mjs', split: 'held_out',
    ...heldOut,
    qualified_current: { ...QUALIFIED_CURRENT_BASELINE },
    thresholds: { ...FROZEN_GATES },
  },
};

assert.deepEqual(validateFixture(fixture), { valid: true, errors: [] });
assert.equal(validateFixtureSchema(fixture), true, JSON.stringify(validateFixtureSchema.errors));

const fullState = {
  head: 'a'.repeat(40), branch: '(detached)', upstream: null, ahead: 0, behind: 0,
  worktree: 'primary', changes: [],
};
const expectedById = new Map(fixture.cases.map((item) => [item.id, {
  id: item.id,
  workflow_outcome: item.expected.workflow_outcome,
  selected_workflow_ids: item.expected.selected_workflow_ids,
  workflow_ranking: item.expected.workflow_ranking.map(({ id }) => ({ id })),
  source_ranking: item.expected.source_ranking.map(({ path, symbol }) => ({ path, symbol })),
  observations: item.expected.observations,
  obligations: item.expected.obligations,
  repository_state: fullState,
}]));

const seenInputs = [];
const alternateInputs = [];
const seenRecipes = [];
let materializationSequence = 0;
const materializer = {
  materialize(scenario, collectionValue) {
    seenRecipes.push(scenario);
    materializationSequence += 1;
    const identity = `${collectionValue.id}:${scenario.name}:${materializationSequence}`;
    return {
      schema: 'lamina.materialized-repository/v1',
      materialization_digest: digest(identity),
      opaque_handle: `/safe-runner/${collectionValue.fixture_id}/${identity}`,
    };
  },
};
const current = {
  id: 'current-normalized', version: 1,
  inputFormat: 'lamina.real-repository-oracle-input/v1',
  outputFormat: 'lamina.real-repository-oracle-result-case/v1',
  evaluate(input) {
    seenInputs.push(input);
    assert.equal(Object.isFrozen(input), true);
    assert.equal('expected' in input, false);
    assert.equal('coverage' in input, false);
    assert.equal('repository_scenario' in input, false);
    assert.equal('operations' in input.materialized_repository, false);
    return structuredClone(expectedById.get(input.case_id));
  },
};
const alternate = {
  id: 'alternate-keyed', version: 1,
  inputFormat: 'lamina.real-repository-oracle-input/v1',
  outputFormat: 'example.alternate-real-repository/v1',
  evaluate(input) {
    alternateInputs.push(input);
    const value = expectedById.get(input.case_id);
    return { key: value.id, answer: structuredClone(value) };
  },
  normalize(raw) { return { ...raw.answer, id: raw.key }; },
};

const selectedCollection = collections[0];
const result = await evaluateAdapter({
  fixture, collection: selectedCollection, adapter: current, materializer,
});
assert.deepEqual(result.safety, {
  outcome: 'not_applicable', reason: null, cleanup_verified: false,
});
assert.deepEqual(validateResult(result), { valid: true, errors: [] });
assert.equal(validateResultSchema(result), true, JSON.stringify(validateResultSchema.errors));
assert.deepEqual(gradeResult(fixture, result), {
  passed: true,
  classification: 'pass',
  metrics: {
    exact_id_alias_accuracy: 1,
    complete_multi_workflow_selection: 1,
    incorrect_new_workflow_attachment: 0,
    workflow_recall_at_5: 1,
    source_recall_at_10: 1,
    deterministic_ordering: true,
  },
  coverage: {
    observations: Object.fromEntries(OBSERVATION_CATEGORIES.map((category) =>
      [category, { expected: 1, matched: 1 }])),
    obligations: Object.fromEntries(OBLIGATION_CATEGORIES.map((category) =>
      [category, { expected: 1, matched: 1 }])),
  },
  diagnostics: [],
});

const pair = await evaluateSideBySide({
  fixture, collection: selectedCollection, current, candidate: alternate, materializer,
});
assert.deepEqual(pair.candidate.cases, pair.current.cases,
  'a differently keyed candidate must normalize to identical semantics');
assert.deepEqual(
  alternateInputs.map((input) => input.materialized_repository.materialization_digest),
  seenInputs.slice(-alternateInputs.length)
    .map((input) => input.materialized_repository.materialization_digest),
  'current, candidate, and replay runs must share identical content-addressed materializations',
);
assert.ok(seenInputs.length >= 6);
assert.equal(seenRecipes.length, 6,
  'each standalone/side-by-side case is materialized once and shared across replays/adapters');
assert.deepEqual(
  adapterInput(fixture.cases[0], selectedCollection, {
    schema: 'lamina.materialized-repository/v1',
    materialization_digest: '1'.repeat(64), opaque_handle: 'same',
  }),
  adapterInput(fixture.cases[0], selectedCollection, {
    schema: 'lamina.materialized-repository/v1',
    materialization_digest: '1'.repeat(64), opaque_handle: 'same',
  }),
  'identical adapters receive byte-stable, expectation-free inputs',
);

const collectionMismatch = structuredClone(result);
collectionMismatch.collection_digest = 'f'.repeat(64);
assert.equal(gradeResult(fixture, collectionMismatch).classification, 'fixture_defect');

const invalid = structuredClone(result);
invalid.cases[0].repository_state.changes = [{ kind: 'invented' }];
assert.equal(gradeResult(fixture, invalid).classification, 'candidate_invalid');

await assert.rejects(
  evaluateAdapter({
    fixture, collection: selectedCollection, adapter: current, materializer,
    evidenceMode: 'semantic_core',
  }),
  /requires trusted safety evidence/,
  'an arbitrary adapter cannot award itself safe-runner cleanup evidence',
);

const lyingClaims = structuredClone(result);
lyingClaims.claims.observation = 'brownfield_signals';
assert.equal(gradeResult(fixture, lyingClaims).classification, 'candidate_invalid');

const truthfulPublic = structuredClone(result);
truthfulPublic.evidence_mode = 'public_cli';
truthfulPublic.safety = { outcome: 'success', reason: null, cleanup_verified: true };
truthfulPublic.claims = {
  end_to_end_runtime: true,
  observation: 'public_cli',
  obligations: 'public_cli',
  source_localization: 'real_retrieval',
};
assert.equal(validateResult(truthfulPublic).valid, true,
  'future #52 public CLI candidates must be able to provide truthful success evidence');

const blocked = safetyBlockedResult({
  collection: selectedCollection, adapterId: 'current-public-cli',
  reason: 'LAMINA_SAFE_PREFLIGHT: pinned worker is unavailable',
  cleanupVerified: true,
});
assert.throws(() => safetyBlockedResult({
  collection: selectedCollection, adapterId: 'untrusted', reason: 'blocked',
}), /caller-supplied cleanup evidence/);
assert.equal(validateResult(blocked).valid, true);
assert.deepEqual(gradeResult(fixture, blocked), {
  passed: false, classification: 'safety_blocked', metrics: null, coverage: null,
  diagnostics: ['LAMINA_SAFE_PREFLIGHT: pinned worker is unavailable'],
});

function mutation(change) {
  const value = structuredClone(result);
  change(value);
  value.replay_digest = resultCasesDigest(value.cases);
  return gradeResult(fixture, value);
}

const wrongWorkflow = mutation((value) => {
  value.cases[0].selected_workflow_ids = ['workflow.wrong'];
});
assert.equal(wrongWorkflow.classification, 'product_regression');
assert.ok(wrongWorkflow.diagnostics.some((item) => item.includes('selected Workflow ids')));

const missingObservation = mutation((value) => { value.cases[0].observations.shift(); });
assert.ok(missingObservation.diagnostics.some((item) => item.includes('missing observation')));

const lostObligation = mutation((value) => { value.cases[0].obligations.shift(); });
assert.ok(lostObligation.diagnostics.some((item) => item.includes('missing obligation')));

const rankingRegression = mutation((value) => { value.cases[0].source_ranking = []; });
assert.ok(rankingRegression.diagnostics.some((item) => item.includes('source src/entry_point.ts#entryPoint')));

const extraMulti = mutation((value) => {
  value.cases[1].selected_workflow_ids.push('workflow.unexpected');
});
assert.ok(extraMulti.diagnostics.some((item) => item.includes('selected Workflow ids')));

const nondeterministic = structuredClone(result);
nondeterministic.replay_digest = '0'.repeat(64);
assert.ok(gradeResult(fixture, nondeterministic).diagnostics.some((item) =>
  item.includes('deterministic ordering')));

const staleFixture = structuredClone(fixture);
staleFixture.cases[0].expected.forbidden_paths = ['src/deleted.ts'];
const staleResult = structuredClone(result);
staleResult.cases[0].observations.push({ category: 'source_file', path: 'src/deleted.ts' });
staleResult.replay_digest = resultCasesDigest(staleResult.cases);
assert.ok(gradeResult(staleFixture, staleResult).diagnostics.some((item) =>
  item.includes('stale deleted or renamed path src/deleted.ts')));

const malformedFixture = structuredClone(fixture);
malformedFixture.collections[0].retrieval_candidate_files = 0;
assert.equal(gradeResult(malformedFixture, result).classification, 'fixture_defect');

const hash = '1'.repeat(40);
const porcelain = [
  `# branch.oid ${hash}`,
  '# branch.head feature/oracle',
  '# branch.upstream origin/feature/oracle',
  '# branch.ab +2 -1',
  `1 .M N... 100644 100644 100644 ${hash} ${hash} src/ordinary.ts`,
  `1 D. N... 100644 000000 000000 ${hash} ${'0'.repeat(40)} src/deleted.ts`,
  `2 R. N... 100644 100644 100644 ${hash} ${hash} R100 src/new name.ts`,
  'src/old name.ts',
  `u UU N... 100644 100644 100644 100644 ${hash} ${hash} ${hash} src/conflict.ts`,
  '? src/untracked.ts',
  '! ignored.txt',
  '',
].join('\0');
const state = parsePorcelainV2Z(porcelain, { worktree: 'linked-1' });
assert.deepEqual({
  head: state.head, branch: state.branch, upstream: state.upstream,
  ahead: state.ahead, behind: state.behind, worktree: state.worktree,
}, {
  head: hash, branch: 'feature/oracle', upstream: 'origin/feature/oracle',
  ahead: 2, behind: 1, worktree: 'linked-1',
});
assert.deepEqual(state.changes.map((item) => [item.kind, item.path, item.original_path]), [
  ['unmerged', 'src/conflict.ts', null],
  ['deleted', 'src/deleted.ts', null],
  ['renamed', 'src/new name.ts', 'src/old name.ts'],
  ['ordinary', 'src/ordinary.ts', null],
  ['untracked', 'src/untracked.ts', null],
]);
assert.throws(() => parsePorcelainV2Z(`# branch.head main\0x nonsense\0`),
  /unknown porcelain v2 record/);

const scenarioDefect = structuredClone(fixture);
scenarioDefect.cases[0].repository_scenario = {
  kind: 'dirty', name: 'bad-rename',
  operations: [{ op: 'rename', path: 'a.ts', destination: null, value: null }],
};
assert.equal(validateFixture(scenarioDefect).valid, false);

console.log('real repository oracle contract tests passed');
