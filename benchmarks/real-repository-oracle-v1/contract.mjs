import crypto from 'node:crypto';

export const FIXTURE_SCHEMA = 'lamina.real-repository-oracle-fixture/v1';
export const RESULT_SCHEMA = 'lamina.real-repository-oracle-result/v1';
export const ADAPTER_SCHEMA = 'lamina.real-repository-oracle-adapter/v1';
export const COLLECTION_SCHEMA = 'lamina.real-repository-collection/v1';

export const REQUIRED_COVERAGE = Object.freeze([
  'exact_workflow_id', 'exact_workflow_alias', 'exact_source_identifier',
  'route', 'handler', 'entity', 'symbol', 'low_overlap_paraphrase',
  'persona', 'permission', 'role_boundary', 'invariant', 'failure_state',
  'multi_workflow', 'new_workflow', 'adversarial', 'one_file', 'multi_file',
  'rename', 'delete', 'dirty_file', 'branch', 'worktree', 'entry_point',
  'command', 'schema_entity', 'transition', 'event', 'test', 'docs_persona',
  'flag', 'dependency',
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
  'ordinary', 'renamed', 'deleted', 'unmerged', 'untracked',
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
  if (object(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function digest(value) {
  return crypto.createHash('sha256').update(
    typeof value === 'string' || Buffer.isBuffer(value)
      ? value : JSON.stringify(canonical(value)),
  ).digest('hex');
}

export function collectionDigest(collection) {
  const { collection_digest: _claimed, ...identity } = collection;
  return digest(identity);
}

function exactKeys(value, keys) {
  return object(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validateCollection(collection, path, errors) {
  if (!exactKeys(collection, [
    'schema', 'id', 'fixture_id', 'fixture_class', 'repository_url', 'commit',
    'baseline_manifest_sha256', 'observation_paths_sha256',
    'observation_candidate_files', 'observation_candidate_bytes',
    'retrieval_paths_sha256', 'retrieval_candidate_files',
    'retrieval_candidate_bytes', 'collection_digest',
  ])) {
    errors.push(`${path} has an invalid shape`);
    return;
  }
  if (collection.schema !== COLLECTION_SCHEMA || !nonempty(collection.id)
    || !['small', 'medium', 'large'].includes(collection.fixture_id)
    || collection.fixture_class !== collection.fixture_id
    || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(collection.repository_url)
    || !COMMIT.test(collection.commit)
    || !SHA256.test(collection.baseline_manifest_sha256)
    || !SHA256.test(collection.observation_paths_sha256)
    || !Number.isSafeInteger(collection.observation_candidate_files)
    || collection.observation_candidate_files < 1
    || !Number.isSafeInteger(collection.observation_candidate_bytes)
    || collection.observation_candidate_bytes < 1
    || !SHA256.test(collection.retrieval_paths_sha256)
    || !Number.isSafeInteger(collection.retrieval_candidate_files)
    || collection.retrieval_candidate_files < 1
    || !Number.isSafeInteger(collection.retrieval_candidate_bytes)
    || collection.retrieval_candidate_bytes < 1
    || !SHA256.test(collection.collection_digest)) {
    errors.push(`${path} identity is invalid`);
  } else if (collection.collection_digest !== collectionDigest(collection)) {
    errors.push(`${path}.collection_digest does not bind the exact collection identity`);
  }
}

function validateTarget(target, path, errors, categories = null) {
  if (!object(target) || !nonempty(target.category)
    || (categories && !categories.includes(target.category))
    || !['id', 'path', 'symbol', 'relation'].some((field) => nonempty(target[field]))
    || Object.keys(target).some((field) => !['category', 'id', 'path', 'symbol', 'relation'].includes(field))) {
    errors.push(`${path} is not a compact stable target`);
  }
}

function validateCase(item, index, collectionIds, errors) {
  const at = `fixture.cases[${index}]`;
  if (!exactKeys(item, [
    'id', 'collection_id', 'request', 'coverage', 'repository_scenario',
    'expected', 'rationale',
  ])) {
    errors.push(`${at} has an invalid shape`);
    return;
  }
  if (!nonempty(item.id) || !collectionIds.has(item.collection_id)
    || !nonempty(item.request) || item.request.length > 600
    || !strings(item.coverage) || !item.coverage.length || !unique(item.coverage)
    || item.coverage.some((category) => !REQUIRED_COVERAGE.includes(category))
    || !nonempty(item.rationale) || item.rationale.length > 300) {
    errors.push(`${at} identity or reviewed rationale is invalid`);
  }
  const scenario = item.repository_scenario;
  if (!object(scenario) || !['clean', 'dirty', 'branch', 'worktree'].includes(scenario.kind)
    || !nonempty(scenario.name) || !Array.isArray(scenario.operations)
    || Object.keys(scenario).some((field) => !['kind', 'name', 'operations'].includes(field))) {
    errors.push(`${at}.repository_scenario is invalid`);
  } else {
    for (const operation of scenario.operations) {
      if (!exactKeys(operation, ['op', 'path', 'destination', 'value'])
        || !['modify', 'rename', 'delete', 'checkout_branch', 'add_worktree'].includes(operation.op)
        || !(operation.path === null || nonempty(operation.path))
        || !(operation.destination === null || nonempty(operation.destination))
        || !(operation.value === null || nonempty(operation.value))
        || (operation.op === 'modify' && (!operation.path || !operation.value))
        || (operation.op === 'rename' && (!operation.path || !operation.destination))
        || (operation.op === 'delete' && !operation.path)
        || (operation.op === 'checkout_branch' && !operation.value)
        || (operation.op === 'add_worktree' && (!operation.destination || !operation.value))) {
        errors.push(`${at}.repository_scenario has an invalid materializer operation`);
      }
    }
    if ((scenario.kind === 'clean') !== (scenario.operations.length === 0)) {
      errors.push(`${at}.repository_scenario clean state and operations disagree`);
    }
  }
  const expected = item.expected;
  if (!exactKeys(expected, [
    'workflow_outcome', 'selected_workflow_ids', 'forbidden_workflow_ids',
    'workflow_ranking', 'source_ranking', 'observations',
    'forbidden_observations', 'obligations', 'forbidden_paths',
    'repository_state',
  ])) {
    errors.push(`${at}.expected has an invalid shape`);
    return;
  }
  if (!['selected', 'multi_workflow', 'new_workflow_required', 'irrelevant'].includes(expected.workflow_outcome)
    || !strings(expected.selected_workflow_ids) || !unique(expected.selected_workflow_ids)
    || !strings(expected.forbidden_workflow_ids) || !unique(expected.forbidden_workflow_ids)
    || !strings(expected.forbidden_paths) || !unique(expected.forbidden_paths)) {
    errors.push(`${at}.expected workflow/path sets are invalid`);
  }
  if (expected.workflow_outcome === 'new_workflow_required' && expected.selected_workflow_ids.length) {
    errors.push(`${at}.expected genuinely new Workflow must select nothing`);
  }
  if (!Array.isArray(expected.workflow_ranking) || expected.workflow_ranking.length > 20
    || expected.workflow_ranking.some((target) => !exactKeys(target, ['id', 'max_rank'])
      || !nonempty(target.id) || !Number.isInteger(target.max_rank)
      || target.max_rank < 1 || target.max_rank > 5)) {
    errors.push(`${at}.expected.workflow_ranking is invalid`);
  }
  if (!Array.isArray(expected.source_ranking) || expected.source_ranking.length > 20
    || expected.source_ranking.some((target) => !exactKeys(target, ['path', 'symbol', 'max_rank'])
      || !nonempty(target.path) || !(target.symbol === null || nonempty(target.symbol))
      || !Number.isInteger(target.max_rank) || target.max_rank < 1 || target.max_rank > 10)) {
    errors.push(`${at}.expected.source_ranking is invalid`);
  }
  for (const [field, categories] of [
    ['observations', OBSERVATION_CATEGORIES],
    ['forbidden_observations', OBSERVATION_CATEGORIES],
    ['obligations', OBLIGATION_CATEGORIES],
  ]) {
    if (!Array.isArray(expected[field]) || expected[field].length > 30) {
      errors.push(`${at}.expected.${field} is invalid`);
    } else {
      expected[field].forEach((target, targetIndex) =>
        validateTarget(target, `${at}.expected.${field}[${targetIndex}]`, errors, categories));
    }
  }
  const state = expected.repository_state;
  if (!object(state) || !nonempty(state.branch) || !nonempty(state.worktree)
    || !Array.isArray(state.changes)
    || state.changes.some((change) => !object(change)
      || !CHANGE_KINDS.includes(change.kind) || !nonempty(change.path)
      || !(change.original_path === null || nonempty(change.original_path))
      || Object.keys(change).some((field) => !['kind', 'path', 'original_path'].includes(field)))) {
    errors.push(`${at}.expected.repository_state is invalid`);
  }
}

export function validateFixture(fixture) {
  const errors = [];
  if (!exactKeys(fixture, [
    'schema', 'id', 'version', 'collections', 'cases', 'mutations',
    'held_out_compatibility',
  ]) || fixture.schema !== FIXTURE_SCHEMA || fixture.version !== 1 || !nonempty(fixture.id)) {
    return { valid: false, errors: ['fixture envelope is invalid'] };
  }
  if (!Array.isArray(fixture.collections) || fixture.collections.length !== 3) {
    errors.push('fixture.collections must bind exactly small, medium, and large');
  }
  for (const [index, collection] of (fixture.collections || []).entries()) {
    validateCollection(collection, `fixture.collections[${index}]`, errors);
  }
  const collectionIds = new Set((fixture.collections || []).map((item) => item?.id));
  if (collectionIds.size !== 3
    || JSON.stringify([...new Set((fixture.collections || []).map((item) => item?.fixture_id))].sort())
      !== JSON.stringify(['large', 'medium', 'small'])) {
    errors.push('fixture collections must uniquely cover all #60 fixture tiers');
  }
  if (!Array.isArray(fixture.cases) || !fixture.cases.length) errors.push('fixture.cases must be non-empty');
  for (const [index, item] of (fixture.cases || []).entries()) validateCase(item, index, collectionIds, errors);
  const ids = (fixture.cases || []).map((item) => item?.id);
  if (!unique(ids)) errors.push('fixture case ids must be unique');
  const covered = new Set((fixture.cases || []).flatMap((item) => item?.coverage || []));
  for (const category of REQUIRED_COVERAGE) {
    if (!covered.has(category)) errors.push(`fixture lacks required coverage ${category}`);
  }
  for (const collection of fixture.collections || []) {
    const cases = (fixture.cases || []).filter((item) => item.collection_id === collection.id);
    const denominators = {
      exact_id_alias_accuracy: cases.filter((item) => item.coverage.some((category) =>
        ['exact_workflow_id', 'exact_workflow_alias'].includes(category))).length,
      complete_multi_workflow_selection: cases.filter((item) => item.coverage.includes('multi_workflow')).length,
      incorrect_new_workflow_attachment: cases.filter((item) => item.coverage.includes('new_workflow')).length,
      workflow_recall_at_5: cases.reduce((sum, item) => sum + item.expected.workflow_ranking.length, 0),
      source_recall_at_10: cases.reduce((sum, item) => sum + item.expected.source_ranking.length, 0),
    };
    for (const [metric, denominator] of Object.entries(denominators)) {
      if (denominator === 0) errors.push(`${collection.id} has a zero denominator for ${metric}`);
    }
    const observationCoverage = new Set(cases.flatMap((item) =>
      item.expected.observations.map((target) => target.category)));
    const obligationCoverage = new Set(cases.flatMap((item) =>
      item.expected.obligations.map((target) => target.category)));
    for (const category of OBSERVATION_CATEGORIES) {
      if (!observationCoverage.has(category)) errors.push(`${collection.id} lacks observation expectation ${category}`);
    }
    for (const category of OBLIGATION_CATEGORIES) {
      if (!obligationCoverage.has(category)) errors.push(`${collection.id} lacks obligation expectation ${category}`);
    }
  }
  if (!Array.isArray(fixture.mutations) || !fixture.mutations.length
    || fixture.mutations.some((mutation) => !exactKeys(mutation, [
      'id', 'case_id', 'kind', 'diagnostic_includes',
    ]) || !nonempty(mutation.id) || !ids.includes(mutation.case_id)
      || !nonempty(mutation.kind) || !strings(mutation.diagnostic_includes)
      || !mutation.diagnostic_includes.length)
    || !unique(fixture.mutations.map((item) => item.id))) {
    errors.push('fixture mutations are invalid');
  }
  if (!exactKeys(fixture.held_out_compatibility, [
    'benchmark', 'split', 'workflow_rows', 'workflow_rows_bytes', 'workflow_rows_sha256',
    'source_rows', 'source_rows_bytes', 'source_rows_sha256', 'qualified_current', 'thresholds',
  ]) || fixture.held_out_compatibility.benchmark !== 'benchmarks/retrieval-v1/benchmark.mjs'
    || fixture.held_out_compatibility.split !== 'held_out'
    || fixture.held_out_compatibility.workflow_rows !== 160
    || fixture.held_out_compatibility.workflow_rows_bytes !== 16928
    || fixture.held_out_compatibility.workflow_rows_sha256 !== '536c7459bb3457ca01b1a5444964bb5cc1d3cea8d7fc3ff5c1c84190f26c9027'
    || fixture.held_out_compatibility.source_rows !== 80
    || fixture.held_out_compatibility.source_rows_bytes !== 11806
    || fixture.held_out_compatibility.source_rows_sha256 !== '080df00ccec46bf06a7b9336c1defd270a312005e872b1e64f29437e08709f99'
    || !exactKeys(fixture.held_out_compatibility.qualified_current,
      Object.keys(QUALIFIED_CURRENT_BASELINE))
    || Object.entries(QUALIFIED_CURRENT_BASELINE).some(([key, value]) =>
      fixture.held_out_compatibility.qualified_current[key] !== value)
    || !exactKeys(fixture.held_out_compatibility.thresholds, Object.keys(FROZEN_GATES))
    || Object.entries(FROZEN_GATES).some(([key, value]) =>
      fixture.held_out_compatibility.thresholds[key] !== value)) {
    errors.push('fixture must preserve the unchanged retrieval-v1 held-out contract');
  }
  return { valid: errors.length === 0, errors };
}

function validateResultCase(item, index, errors) {
  const at = `result.cases[${index}]`;
  if (!exactKeys(item, [
    'id', 'workflow_outcome', 'selected_workflow_ids', 'workflow_ranking',
    'source_ranking', 'observations', 'obligations', 'repository_state',
  ]) || !nonempty(item.id)
    || !['selected', 'multi_workflow', 'new_workflow_required', 'irrelevant'].includes(item.workflow_outcome)
    || !strings(item.selected_workflow_ids) || !unique(item.selected_workflow_ids)
    || !Array.isArray(item.workflow_ranking) || item.workflow_ranking.some((entry) =>
      !exactKeys(entry, ['id']) || !nonempty(entry.id))
    || !Array.isArray(item.source_ranking) || item.source_ranking.some((entry) =>
      !exactKeys(entry, ['path', 'symbol']) || !nonempty(entry.path)
      || !(entry.symbol === null || nonempty(entry.symbol)))
    || !Array.isArray(item.observations) || !Array.isArray(item.obligations)) {
    errors.push(`${at} is invalid`);
    return;
  }
  item.observations.forEach((target, targetIndex) =>
    validateTarget(target, `${at}.observations[${targetIndex}]`, errors, OBSERVATION_CATEGORIES));
  item.obligations.forEach((target, targetIndex) =>
    validateTarget(target, `${at}.obligations[${targetIndex}]`, errors, OBLIGATION_CATEGORIES));
  const state = item.repository_state;
  if (!exactKeys(state, [
    'head', 'branch', 'upstream', 'ahead', 'behind', 'worktree', 'changes',
  ]) || !(state.head === null || COMMIT.test(state.head))
    || !nonempty(state.branch) || !(state.upstream === null || nonempty(state.upstream))
    || !Number.isSafeInteger(state.ahead) || state.ahead < 0
    || !Number.isSafeInteger(state.behind) || state.behind < 0
    || !nonempty(state.worktree) || !Array.isArray(state.changes)
    || state.changes.some((change) => !exactKeys(change, [
      'kind', 'path', 'original_path', 'xy', 'submodule',
    ]) || !CHANGE_KINDS.includes(change.kind) || !nonempty(change.path)
      || !(change.original_path === null || nonempty(change.original_path))
      || !(change.xy === null || (typeof change.xy === 'string' && change.xy.length === 2))
      || !(change.submodule === null || nonempty(change.submodule)))) {
    errors.push(`${at}.repository_state is invalid`);
  }
}

export function validateResult(result) {
  const errors = [];
  if (!exactKeys(result, [
    'schema', 'adapter', 'collection_id', 'collection_digest', 'evidence_mode',
    'claims', 'safety', 'cases', 'replay_digest',
  ]) || result.schema !== RESULT_SCHEMA
    || !exactKeys(result.adapter, ['schema', 'id', 'version', 'input_format', 'output_format'])
    || result.adapter?.schema !== ADAPTER_SCHEMA || !nonempty(result.adapter?.id)
    || !Number.isInteger(result.adapter?.version) || result.adapter.version < 1
    || result.adapter?.input_format !== 'lamina.real-repository-oracle-input/v1'
    || !nonempty(result.adapter?.output_format)
    || !nonempty(result.collection_id) || !SHA256.test(result.collection_digest || '')
    || !['oracle_validation', 'semantic_core', 'public_cli'].includes(result.evidence_mode)
    || !exactKeys(result.claims, [
      'end_to_end_runtime', 'observation', 'obligations', 'source_localization',
    ]) || typeof result.claims?.end_to_end_runtime !== 'boolean'
    || !['brownfield_signals', 'public_cli', 'not_measured'].includes(result.claims?.observation)
    || !['compiled', 'public_cli', 'not_measured'].includes(result.claims?.obligations)
    || !['real_retrieval', 'not_measured'].includes(result.claims?.source_localization)
    || !exactKeys(result.safety, ['outcome', 'reason', 'cleanup_verified'])
    || !['not_applicable', 'success', 'blocked'].includes(result.safety?.outcome)
    || !(result.safety?.reason === null || nonempty(result.safety?.reason))
    || typeof result.safety?.cleanup_verified !== 'boolean'
    || !Array.isArray(result.cases)
    || !(result.replay_digest === null || SHA256.test(result.replay_digest || ''))) {
    return { valid: false, errors: ['result envelope is invalid'] };
  }
  if (result.safety.outcome === 'blocked' && result.cases.length) {
    errors.push('safety-blocked results must not contain quality cases');
  }
  const noClaims = result.claims?.end_to_end_runtime === false
    && result.claims?.observation === 'not_measured'
    && result.claims?.obligations === 'not_measured'
    && result.claims?.source_localization === 'not_measured';
  if (result.safety?.outcome === 'blocked' && !noClaims) {
    errors.push('safety-blocked results cannot retain measured claims');
  }
  if (result.evidence_mode === 'oracle_validation'
    && (result.safety?.outcome !== 'not_applicable' || !noClaims)) {
    errors.push('oracle validation cannot claim runtime safety or measured product evidence');
  }
  if (result.evidence_mode === 'semantic_core'
    && (result.safety?.outcome === 'not_applicable'
      || result.claims?.end_to_end_runtime !== false
      || !['brownfield_signals', 'not_measured'].includes(result.claims?.observation)
      || !['compiled', 'not_measured'].includes(result.claims?.obligations))) {
    errors.push('semantic-core evidence claims exceed the direct production seams');
  }
  if (result.evidence_mode === 'public_cli') {
    if (result.safety?.outcome === 'not_applicable') {
      errors.push('public CLI evidence requires an explicit safety outcome');
    } else if (result.safety?.outcome === 'success'
      && (result.claims?.end_to_end_runtime !== true
        || result.claims?.observation !== 'public_cli'
        || result.claims?.obligations !== 'public_cli'
        || result.claims?.source_localization !== 'real_retrieval')) {
      errors.push('successful public CLI evidence lacks its required end-to-end claims');
    }
  }
  for (const [index, item] of result.cases.entries()) validateResultCase(item, index, errors);
  if (!unique(result.cases.map((item) => item?.id))) errors.push('result case ids must be unique');
  return { valid: errors.length === 0, errors };
}

export function resultCasesDigest(cases) {
  return digest(cases);
}
