import crypto from 'node:crypto';
import fs from 'node:fs';
import { validateFixtureSchema, validateResultSchema, schemaErrors } from './schema-validation.mjs';
import { isVerifierAttestation } from './attestation-authority.mjs';

export const FIXTURE_SCHEMA = 'lamina.real-repository-oracle-fixture/v1';
export const RESULT_SCHEMA = 'lamina.real-repository-oracle-result/v1';
export const ADAPTER_SCHEMA = 'lamina.real-repository-oracle-adapter/v1';
export const COLLECTION_SCHEMA = 'lamina.real-repository-collection/v1';
export const ATTESTATION_SCHEMA = 'lamina.real-repository-oracle-attestation/v1';

export const QUERY_KINDS = Object.freeze([
  'exact_workflow_id', 'exact_workflow_alias', 'exact_source_identifier',
  'route', 'handler', 'entity', 'symbol', 'low_overlap_paraphrase', 'persona',
  'permission', 'role_boundary', 'invariant', 'failure_state', 'entry_point',
  'command', 'schema_entity', 'transition', 'event', 'test', 'docs_persona',
  'flag', 'dependency',
]);
export const INTENT_KINDS = Object.freeze([
  'workflow_selection', 'multi_workflow', 'new_workflow', 'source_localization',
  'observation', 'obligations', 'adversarial',
]);
export const SCOPE_KINDS = Object.freeze(['one_file', 'multi_file', 'repository']);

export const REQUIRED_COVERAGE = Object.freeze([
  ...QUERY_KINDS, 'multi_workflow', 'new_workflow', 'adversarial',
  'one_file', 'multi_file', 'rename', 'delete', 'dirty_file', 'branch', 'worktree',
]);
export const OBSERVATION_CATEGORIES = Object.freeze([
  'entry_point', 'command', 'schema_entity', 'transition', 'event', 'test',
  'docs_persona', 'flag', 'dependency', 'permission', 'invariant',
  'failure_state', 'source_file',
]);
export const OBLIGATION_CATEGORIES = Object.freeze([
  'implementation', 'state', 'permission', 'failure', 'persona',
  'completeness', 'verification',
]);
export const CHANGE_KINDS = Object.freeze([
  'ordinary', 'renamed', 'copied', 'deleted', 'unmerged', 'untracked',
]);
export const OPERATION_KINDS = Object.freeze([
  'modify', 'rename', 'delete', 'checkout_branch', 'add_worktree',
]);
export const MUTATION_KINDS = Object.freeze([
  'wrong_workflow', 'missing_observation', 'lost_obligation',
  'source_ranking_regression', 'extra_workflow', 'nondeterministic_replay',
  'repository_state_mismatch',
]);

export const FROZEN_GATES = Object.freeze({
  exact_id_alias_accuracy: 1,
  complete_multi_workflow_selection: 0.95,
  incorrect_new_workflow_attachment: 0.02,
  workflow_recall_at_5: 0.99,
  source_recall_at_10: 0.9275,
});
export const QUALIFIED_CURRENT_BASELINE = Object.freeze({
  workflow_recall_at_5: 1,
  source_recall_at_10: 0.9375,
});

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const unique = (value) => new Set(value).size === value.length;
const nonempty = (value) => typeof value === 'string' && value.length > 0;

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export function digest(value) {
  return crypto.createHash('sha256').update(
    typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value)),
  ).digest('hex');
}

const manifestBytes = fs.readFileSync(new URL('../runtime-baseline-v1/manifest.json', import.meta.url));
const manifest = JSON.parse(manifestBytes);
export const BASELINE_MANIFEST_SHA256 = '9e8319288d69b77f77f2b3e386c868f83e62a1b7032ca4f3deb443acf60bb3ba';
if (digest(manifestBytes) !== BASELINE_MANIFEST_SHA256) {
  throw new Error('runtime baseline manifest bytes no longer match the reviewed #60 identity');
}
export const COLLECTION_PINS = Object.freeze(Object.fromEntries(manifest.fixtures.map((fixture) => [fixture.id, Object.freeze({
  fixture_id: fixture.id, fixture_class: fixture.class,
  repository_url: fixture.url, commit: fixture.commit,
})])));
export const CANDIDATE_POLICY_SHA256 = digest({
  source_extensions: manifest.source_extensions,
  retrieval_extensions: manifest.retrieval_extensions,
  retrieval_max_file_bytes: manifest.retrieval_max_file_bytes,
  exclusions: manifest.exclusions,
});

export function collectionDigest(collection) {
  const { collection_digest: _claimed, ...identity } = collection;
  return digest(identity);
}
function exactKeys(value, keys) {
  return object(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function isSafeRelativePath(value) {
  if (!nonempty(value) || value.includes('\0') || value.includes('\\')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.startsWith('//')) return false;
  const pieces = value.split('/');
  return pieces.every((piece) => piece && piece !== '.' && piece !== '..');
}
export function isSafeBranchName(value) {
  if (!nonempty(value) || value.length > 255 || /[\x00-\x20~^:?*\[\\]/.test(value)
    || value.includes('..') || value.includes('@{') || value.includes('//')
    || value.startsWith('/') || value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) return false;
  return value.split('/').every((piece) => piece && !piece.startsWith('.'));
}

function validateCollection(collection, at, errors) {
  const pin = COLLECTION_PINS[collection?.fixture_id];
  if (!pin || collection.fixture_class !== pin.fixture_class
    || collection.repository_url !== pin.repository_url || collection.commit !== pin.commit
    || collection.baseline_manifest_sha256 !== BASELINE_MANIFEST_SHA256
    || collection.candidate_policy_sha256 !== CANDIDATE_POLICY_SHA256) {
    errors.push(`${at} does not match the frozen #60 repository manifest and candidate-subset policy`);
  }
  if (collection?.collection_digest !== collectionDigest(collection)) {
    errors.push(`${at}.collection_digest does not bind the exact frozen collection identity`);
  }
}

function validateOperation(operation, at, errors) {
  if (['modify', 'delete'].includes(operation.op) && !isSafeRelativePath(operation.path)) {
    errors.push(`${at}.path must be a normalized repository-relative path`);
  }
  if (operation.op === 'rename'
    && (!isSafeRelativePath(operation.path) || !isSafeRelativePath(operation.to))) {
    errors.push(`${at} rename paths must be normalized repository-relative paths`);
  }
  if (['checkout_branch', 'add_worktree'].includes(operation.op) && !isSafeBranchName(operation.branch)) {
    errors.push(`${at}.branch is not a safe Git branch name`);
  }
  if (operation.op === 'add_worktree' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(operation.worktree_id)) {
    errors.push(`${at}.worktree_id must be a logical identifier, not a destination path`);
  }
}

function validateTargetPaths(target, at, errors) {
  if (target.path !== undefined && !isSafeRelativePath(target.path)) errors.push(`${at}.path is unsafe`);
}

export function derivedCoverage(item) {
  const coverage = new Set([item.kind.query]);
  if (['multi_workflow', 'new_workflow', 'adversarial'].includes(item.kind.intent)) coverage.add(item.kind.intent);
  if (item.kind.scope !== 'repository') coverage.add(item.kind.scope);
  const operations = item.repository_scenario.operations;
  if (operations.length) coverage.add('dirty_file');
  for (const operation of operations) {
    if (operation.op === 'rename') coverage.add('rename');
    if (operation.op === 'delete') coverage.add('delete');
    if (operation.op === 'checkout_branch') coverage.add('branch');
    if (operation.op === 'add_worktree') coverage.add('worktree');
  }
  return [...coverage];
}

function validateCase(item, index, collectionIds, errors) {
  const at = `fixture.cases[${index}]`;
  if (!collectionIds.has(item.collection_id)) errors.push(`${at}.collection_id is unknown`);
  for (const [operationIndex, operation] of item.repository_scenario.operations.entries()) {
    validateOperation(operation, `${at}.repository_scenario.operations[${operationIndex}]`, errors);
  }
  if ((item.repository_scenario.kind === 'clean') !== (item.repository_scenario.operations.length === 0)) {
    errors.push(`${at}.repository_scenario clean state and operations disagree`);
  }
  if (item.expected.workflow_outcome === 'new_workflow_required'
    && item.expected.selected_workflow_ids.length !== 0) {
    errors.push(`${at} genuinely new Workflow must select nothing`);
  }
  if (['selected', 'multi_workflow'].includes(item.expected.workflow_outcome)
    && item.expected.selected_workflow_ids.length === 0) {
    errors.push(`${at} selected Workflow outcome requires at least one selected id`);
  }
  for (const field of ['source_ranking', 'observations', 'forbidden_observations', 'obligations']) {
    item.expected[field].forEach((target, targetIndex) => validateTargetPaths(target, `${at}.expected.${field}[${targetIndex}]`, errors));
  }
  item.expected.forbidden_paths.forEach((candidate, targetIndex) => {
    if (!isSafeRelativePath(candidate)) errors.push(`${at}.expected.forbidden_paths[${targetIndex}] is unsafe`);
  });
  item.expected.repository_state.changes.forEach((change, changeIndex) => {
    if (!isSafeRelativePath(change.path)
      || (change.original_path !== null && !isSafeRelativePath(change.original_path))) {
      errors.push(`${at}.expected.repository_state.changes[${changeIndex}] contains an unsafe path`);
    }
  });
}

export function validateFixture(fixture) {
  const errors = [];
  if (!validateFixtureSchema(fixture)) return { valid: false, errors: schemaErrors(validateFixtureSchema) };
  fixture.collections.forEach((collection, index) => validateCollection(collection, `fixture.collections[${index}]`, errors));
  const collectionIds = new Set(fixture.collections.map((item) => item.id));
  if (collectionIds.size !== 3 || new Set(fixture.collections.map((item) => item.fixture_id)).size !== 3) {
    errors.push('fixture collections must uniquely cover all #60 fixture tiers');
  }
  fixture.cases.forEach((item, index) => validateCase(item, index, collectionIds, errors));
  if (!unique(fixture.cases.map((item) => item.id))) errors.push('fixture case ids must be unique');
  const covered = new Set(fixture.cases.flatMap(derivedCoverage));
  for (const category of REQUIRED_COVERAGE) if (!covered.has(category)) errors.push(`fixture lacks derived coverage ${category}`);
  for (const collection of fixture.collections) {
    const cases = fixture.cases.filter((item) => item.collection_id === collection.id);
    const denominators = {
      exact_id_alias_accuracy: cases.filter((item) => ['exact_workflow_id', 'exact_workflow_alias'].includes(item.kind.query)).length,
      complete_multi_workflow_selection: cases.filter((item) => item.kind.intent === 'multi_workflow').length,
      incorrect_new_workflow_attachment: cases.filter((item) => item.kind.intent === 'new_workflow').length,
      workflow_recall_at_5: cases.filter((item) => item.expected.workflow_ranking.length).length,
      source_recall_at_10: cases.filter((item) => item.expected.source_ranking.length).length,
    };
    for (const [metric, denominator] of Object.entries(denominators)) if (!denominator) errors.push(`${collection.id} has a zero query denominator for ${metric}`);
    const observationCoverage = new Set(cases.flatMap((item) => item.expected.observations.map((target) => target.category)));
    const obligationCoverage = new Set(cases.flatMap((item) => item.expected.obligations.map((target) => target.category)));
    for (const category of OBSERVATION_CATEGORIES) if (!observationCoverage.has(category)) errors.push(`${collection.id} lacks observation expectation ${category}`);
    for (const category of OBLIGATION_CATEGORIES) if (!obligationCoverage.has(category)) errors.push(`${collection.id} lacks obligation expectation ${category}`);
  }
  if (!unique(fixture.mutations.map((item) => item.id))) errors.push('fixture mutation ids must be unique');
  for (const mutation of fixture.mutations) if (!fixture.cases.some((item) => item.id === mutation.case_id)) errors.push(`mutation ${mutation.id} references an unknown case`);
  const held = fixture.held_out_compatibility;
  if (held.benchmark !== 'benchmarks/retrieval-v1/benchmark.mjs' || held.split !== 'held_out'
    || held.workflow_rows !== 160 || held.workflow_rows_bytes !== 16928
    || held.workflow_rows_sha256 !== '536c7459bb3457ca01b1a5444964bb5cc1d3cea8d7fc3ff5c1c84190f26c9027'
    || held.source_rows !== 80 || held.source_rows_bytes !== 11806
    || held.source_rows_sha256 !== '080df00ccec46bf06a7b9336c1defd270a312005e872b1e64f29437e08709f99'
    || JSON.stringify(held.qualified_current) !== JSON.stringify(QUALIFIED_CURRENT_BASELINE)
    || JSON.stringify(held.thresholds) !== JSON.stringify(FROZEN_GATES)) {
    errors.push('fixture must preserve the unchanged retrieval-v1 held-out contract');
  }
  return { valid: errors.length === 0, errors };
}

function validateResultPaths(item, index, errors) {
  const at = `result.cases[${index}]`;
  for (const field of ['source_ranking', 'observations', 'obligations']) {
    item[field].forEach((target, targetIndex) => validateTargetPaths(target, `${at}.${field}[${targetIndex}]`, errors));
  }
  item.repository_state.changes.forEach((change, changeIndex) => {
    if (!isSafeRelativePath(change.path)
      || (change.original_path !== null && !isSafeRelativePath(change.original_path))) {
      errors.push(`${at}.repository_state.changes[${changeIndex}] contains an unsafe path`);
    }
  });
}

export function validateResult(result, { safetyAttestation = null, allowUnattested = false } = {}) {
  const errors = [];
  if (!validateResultSchema(result)) return { valid: false, errors: schemaErrors(validateResultSchema) };
  const noClaims = result.claims.end_to_end_runtime === false
    && result.claims.observation === 'not_measured' && result.claims.obligations === 'not_measured'
    && result.claims.source_localization === 'not_measured';
  if (result.evidence_mode === 'oracle_validation') {
    if (result.safety.mode !== 'not_applicable' || !noClaims) errors.push('oracle validation cannot claim runtime safety or measured product evidence');
  } else if (result.safety.mode === 'unattested') {
    if (!allowUnattested) errors.push('measured results require verifier-produced safe-runner attestation');
  } else if (!safetyAttestation || !isVerifierAttestation(safetyAttestation)
    || result.safety.attestation !== safetyAttestation) {
    errors.push('measured results require the exact verifier-produced attestation object');
  }
  if (result.evidence_mode === 'semantic_core'
    && (result.claims.end_to_end_runtime !== false
      || !['brownfield_signals', 'not_measured'].includes(result.claims.observation)
      || !['compiled', 'not_measured'].includes(result.claims.obligations))) {
    errors.push('semantic-core evidence claims exceed the direct production seams');
  }
  if (result.evidence_mode === 'public_cli' && result.safety.outcome === 'success'
    && (result.claims.end_to_end_runtime !== true || result.claims.observation !== 'public_cli'
      || result.claims.obligations !== 'public_cli' || result.claims.source_localization !== 'real_retrieval')) {
    errors.push('successful public CLI evidence lacks its required end-to-end claims');
  }
  if (result.safety.outcome === 'success' && (!result.cases.length || result.replay_digest === null)) {
    errors.push('successful evidence requires non-empty cases and a replay digest');
  }
  if (result.safety.mode === 'not_applicable'
    && (result.safety.outcome !== 'not_applicable' || result.safety.attestation !== null)) {
    errors.push('not-applicable safety cannot contain an outcome or attestation');
  }
  if (result.safety.mode === 'unattested'
    && (result.safety.outcome !== 'pending' || result.safety.attestation !== null)) {
    errors.push('unattested workload payload must remain pending without self-issued proof');
  }
  if (result.safety.mode === 'attested' && (result.safety.attestation === null
    || result.safety.attestation.cleanup_verified !== true
    || result.safety.attestation.result_sha256 !== attestableResultDigest(result)
    || (result.safety.outcome === 'success' && result.safety.attestation.runner_outcome !== 'success')
    || (result.safety.outcome === 'blocked' && result.safety.attestation.runner_outcome === 'success'))) {
    errors.push('attested safety outcome is inconsistent with the verified runner report');
  }
  if (result.safety.outcome === 'blocked' && (result.cases.length || result.replay_digest !== null || !noClaims)) {
    errors.push('safety-blocked evidence cannot retain cases, replay, or measured claims');
  }
  result.cases.forEach((item, index) => validateResultPaths(item, index, errors));
  if (!unique(result.cases.map((item) => item.id))) errors.push('result case ids must be unique');
  const materializationIds = result.materializations.map((item) => item.case_id);
  if (!unique(materializationIds)) errors.push('result materialization case ids must be unique');
  if (result.cases.length && !sameSet(materializationIds, result.cases.map((item) => item.id))) errors.push('every result case must have exact materialization provenance');
  return { valid: errors.length === 0, errors };
}

function sameSet(left, right) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}
export function resultCasesDigest(cases) { return digest(cases); }
export function attestableResultDigest(result) {
  const { safety: _safety, ...bound } = result;
  return digest(bound);
}

const mutationExecutors = Object.freeze({
  wrong_workflow(result, index) { result.cases[index].selected_workflow_ids = ['workflow.mutated-wrong']; },
  missing_observation(result, index) { result.cases[index].observations.shift(); },
  lost_obligation(result, index) { result.cases[index].obligations.shift(); },
  source_ranking_regression(result, index) { result.cases[index].source_ranking = []; },
  extra_workflow(result, index) { result.cases[index].selected_workflow_ids.push('workflow.mutated-extra'); },
  nondeterministic_replay(result) { result.replay_digest = '0'.repeat(64); },
  repository_state_mismatch(result, index) { result.cases[index].repository_state.ahead += 1; },
});
export function executeRegisteredMutation(result, mutation) {
  const executor = mutationExecutors[mutation.kind];
  if (!executor) throw new Error(`unknown registered mutation kind: ${mutation.kind}`);
  const output = structuredClone(result);
  const index = output.cases.findIndex((item) => item.id === mutation.case_id);
  if (index < 0) throw new Error(`mutation case is absent: ${mutation.case_id}`);
  executor(output, index);
  if (mutation.kind !== 'nondeterministic_replay') output.replay_digest = resultCasesDigest(output.cases);
  return output;
}
