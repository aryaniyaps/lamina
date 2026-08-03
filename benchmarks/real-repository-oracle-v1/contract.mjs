import crypto from 'node:crypto';
import { validateFixtureSchema, validateResultSchema, schemaErrors } from './schema-validation.mjs';
import {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, COLLECTION_PINS,
  reviewedManifestDigest,
} from './collection-authority.mjs';
import { OBSERVATION_CATEGORY_SUPPORT } from './observation-category-authority.mjs';

export {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, COLLECTION_PINS,
  reviewedManifestDigest,
} from './collection-authority.mjs';

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
  'workflow_selection', 'multi_workflow', 'ambiguous_workflow', 'new_workflow', 'source_localization',
  'observation', 'obligations', 'adversarial',
]);
export const SCOPE_KINDS = Object.freeze(['one_file', 'multi_file', 'repository']);

export const REQUIRED_COVERAGE = Object.freeze([
  ...QUERY_KINDS, 'multi_workflow', 'ambiguous_workflow', 'new_workflow', 'adversarial',
  'one_file', 'multi_file', 'rename', 'delete', 'dirty_file', 'branch', 'worktree',
]);
export const OBSERVATION_CATEGORIES = Object.freeze([
  'entry_points', 'commands', 'routes', 'handlers', 'schemas', 'entities',
  'state_transitions', 'permissions', 'events', 'tests', 'documentation',
  'personas', 'feature_flags', 'dependencies',
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
// Materialization is deterministic: modify/delete remain unstaged, while a
// rename is staged after the filesystem move so Git emits one type-2 R. record
// instead of an unstaged delete plus untracked destination.
export const DIRTY_OPERATION_PORCELAIN = Object.freeze({
  modify: Object.freeze({ kind: 'ordinary', xy: '.M', submodule: 'N...', staging: 'unstaged' }),
  rename: Object.freeze({ kind: 'renamed', xy: 'R.', submodule: 'N...', staging: 'staged' }),
  delete: Object.freeze({ kind: 'deleted', xy: '.D', submodule: 'N...', staging: 'unstaged' }),
});
export const MUTATION_KINDS = Object.freeze([
  'wrong_workflow', 'missing_observation', 'unexpected_observation', 'lost_obligation',
  'source_ranking_regression', 'extra_workflow', 'nondeterministic_replay',
  'repository_state_mismatch', 'stale_rename_path', 'stale_delete_path',
]);
export const MUTATION_APPLICABILITY = Object.freeze({
  wrong_workflow: 'selected_workflow', missing_observation: 'observation',
  unexpected_observation: 'forbidden_observation',
  lost_obligation: 'obligation', source_ranking_regression: 'source_ranking',
  extra_workflow: 'multi_workflow', nondeterministic_replay: 'replay',
  repository_state_mismatch: 'repository_state', stale_rename_path: 'rename',
  stale_delete_path: 'delete',
});

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

export function collectionDigest(collection) {
  const { collection_digest: _claimed, ...identity } = collection;
  return digest(identity);
}
export function fixtureDigest(fixture) { return digest(fixture); }
function materializationIdentity(collection, scenarioDigest) {
  return {
    repository_url: collection.repository_url,
    resolved_commit: collection.commit,
    tree_oid: collection.tree_oid,
    scenario_digest: scenarioDigest,
    candidate_policy_sha256: collection.candidate_policy_sha256,
  };
}
export function materializationProvenanceDigest(collection, scenarioDigest) {
  return digest(materializationIdentity(collection, scenarioDigest));
}
export function materializationBaseDigest(collection, scenarioDigest) {
  const identity = materializationIdentity(collection, scenarioDigest);
  return digest({
    schema: 'lamina.real-repository-oracle-logical-base/v1',
    ...identity,
    provenance_digest: digest(identity),
  });
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
    || collection.tree_oid !== pin.tree_oid
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
  if (operation.op === 'rename' && operation.path === operation.to) {
    errors.push(`${at} rename must change the repository-relative path`);
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
  if (['multi_workflow', 'ambiguous_workflow', 'new_workflow', 'adversarial'].includes(item.kind.intent)) coverage.add(item.kind.intent);
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

function validateCase(item, index, collectionsById, errors) {
  const at = `fixture.cases[${index}]`;
  const collection = collectionsById.get(item.collection_id);
  if (!collection) errors.push(`${at}.collection_id is unknown`);
  for (const [operationIndex, operation] of item.repository_scenario.operations.entries()) {
    validateOperation(operation, `${at}.repository_scenario.operations[${operationIndex}]`, errors);
  }
  if ((item.repository_scenario.kind === 'clean') !== (item.repository_scenario.operations.length === 0)) {
    errors.push(`${at}.repository_scenario clean state and operations disagree`);
  }
  const operations = item.repository_scenario.operations.map((operation) => operation.op);
  if ((item.repository_scenario.kind === 'dirty'
      && (!operations.length || operations.some((op) => !['modify', 'rename', 'delete'].includes(op))))
    || (item.repository_scenario.kind === 'branch'
      && (operations.length !== 1 || operations[0] !== 'checkout_branch'))
    || (item.repository_scenario.kind === 'worktree'
      && (operations.length !== 1 || operations[0] !== 'add_worktree'))) {
    errors.push(`${at}.repository_scenario kind does not match its executable operations`);
  }
  if (item.repository_scenario.kind === 'dirty') {
    const claimedPaths = new Map();
    for (const [operationIndex, operation] of item.repository_scenario.operations.entries()) {
      const paths = operation.op === 'rename' ? [operation.path, operation.to] : [operation.path];
      for (const candidate of paths) {
        const conflict = [...claimedPaths.keys()].find((claimed) => candidate === claimed
          || candidate.startsWith(`${claimed}/`) || claimed.startsWith(`${candidate}/`));
        if (conflict) {
          errors.push(`${at}.repository_scenario.operations[${operationIndex}] conflicts with another dirty operation at ${candidate}`);
        } else {
          claimedPaths.set(candidate, operationIndex);
        }
      }
    }
  }
  const expectedWorktreeRole = item.repository_scenario.kind === 'worktree'
    ? item.repository_scenario.operations[0]?.worktree_id : 'primary';
  if (item.expected.repository_state.worktree_role !== expectedWorktreeRole) {
    errors.push(`${at}.expected.repository_state.worktree_role contradicts the stable scenario role`);
  }
  const expectedBranch = ['branch', 'worktree'].includes(item.repository_scenario.kind)
    ? item.repository_scenario.operations[0]?.branch : '(detached)';
  if (item.expected.repository_state.branch !== expectedBranch) {
    errors.push(`${at}.expected.repository_state.branch contradicts the scenario branch policy`);
  }
  if (collection && item.expected.repository_state.head !== collection.commit) {
    errors.push(`${at}.expected.repository_state.head contradicts the pinned collection commit`);
  }
  if (item.expected.repository_state.upstream !== null
    || item.expected.repository_state.ahead !== 0 || item.expected.repository_state.behind !== 0) {
    errors.push(`${at}.expected.repository_state must begin without upstream divergence`);
  }
  const expectedChanges = item.repository_scenario.operations.flatMap((operation) => {
    const semantics = DIRTY_OPERATION_PORCELAIN[operation.op];
    if (operation.op === 'modify') return [{ kind: semantics.kind, path: operation.path, original_path: null, xy: semantics.xy, submodule: semantics.submodule }];
    if (operation.op === 'rename') return [{ kind: semantics.kind, path: operation.to, original_path: operation.path, xy: semantics.xy, submodule: semantics.submodule }];
    if (operation.op === 'delete') return [{ kind: semantics.kind, path: operation.path, original_path: null, xy: semantics.xy, submodule: semantics.submodule }];
    return [];
  });
  const reviewedChanges = item.expected.repository_state.changes;
  const changeOrder = (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right));
  if (JSON.stringify([...reviewedChanges].sort(changeOrder)) !== JSON.stringify(expectedChanges.sort(changeOrder))) {
    errors.push(`${at}.expected.repository_state.changes must exactly realize the reviewed scenario operations`);
  }
  const selectedCount = item.expected.selected_workflow_ids.length;
  if ((item.expected.workflow_outcome === 'selected' && selectedCount !== 1)
    || (item.expected.workflow_outcome === 'multi_workflow' && selectedCount < 2)
    || (['new_workflow_required', 'ambiguous'].includes(item.expected.workflow_outcome) && selectedCount !== 0)) {
    errors.push(`${at} workflow outcome has invalid selected Workflow cardinality`);
  }
  if (item.expected.selected_workflow_ids.some((id) => item.expected.forbidden_workflow_ids.includes(id))) {
    errors.push(`${at}.expected selected and forbidden Workflow ids must be disjoint`);
  }
  const expectedOutcome = item.kind.intent === 'multi_workflow' ? 'multi_workflow'
    : item.kind.intent === 'ambiguous_workflow' ? 'ambiguous'
      : ['new_workflow', 'adversarial'].includes(item.kind.intent) ? 'new_workflow_required' : 'selected';
  const incompatibleOutcome = expectedOutcome ? item.expected.workflow_outcome !== expectedOutcome
    : true;
  if (incompatibleOutcome) {
    errors.push(`${at}.kind.intent contradicts workflow_outcome`);
  }
  for (const field of ['source_ranking', 'observations', 'forbidden_observations', 'obligations']) {
    item.expected[field].forEach((target, targetIndex) => validateTargetPaths(target, `${at}.expected.${field}[${targetIndex}]`, errors));
  }
  for (const target of [...item.expected.observations, ...item.expected.forbidden_observations]) {
    if (!OBSERVATION_CATEGORIES.includes(target.category)) {
      errors.push(`${at} contains an observation outside the normalized production vocabulary`);
    }
  }
  for (const target of item.expected.obligations) {
    if (!OBLIGATION_CATEGORIES.includes(target.category)) {
      errors.push(`${at} contains an obligation outside the normalized oracle vocabulary`);
    }
  }
  item.expected.forbidden_paths.forEach((candidate, targetIndex) => {
    if (!isSafeRelativePath(candidate)) errors.push(`${at}.expected.forbidden_paths[${targetIndex}] is unsafe`);
    if (item.expected.source_ranking.some((target) => target.path === candidate)
      || item.expected.observations.some((target) => target.path === candidate)) {
      errors.push(`${at}.expected.forbidden_paths[${targetIndex}] contradicts a positive expected target`);
    }
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
  const collectionsById = new Map(fixture.collections.map((item) => [item.id, item]));
  if (collectionsById.size !== 3 || new Set(fixture.collections.map((item) => item.fixture_id)).size !== 3) {
    errors.push('fixture collections must uniquely cover all #60 fixture tiers');
  }
  fixture.cases.forEach((item, index) => validateCase(item, index, collectionsById, errors));
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
    const support = OBSERVATION_CATEGORY_SUPPORT[collection.fixture_id];
    const observationCoverage = new Set(cases.flatMap((item) => item.expected.observations.map((target) => target.category)));
    const positiveTargets = cases.flatMap((item) => item.expected.observations);
    const forbiddenTargets = cases.flatMap((item) => item.expected.forbidden_observations);
    const obligationCoverage = new Set(cases.flatMap((item) => item.expected.obligations.map((target) => target.category)));
    for (const category of support.positive) {
      if (!observationCoverage.has(category)) errors.push(`${collection.id} lacks supported observation expectation ${category}`);
    }
    for (const target of positiveTargets) {
      if (support.positive.includes(target.category)
        && !support.positive_targets.some((reviewed) => exactKeys(target, Object.keys(reviewed))
          && JSON.stringify(target) === JSON.stringify(reviewed))) {
        errors.push(`${collection.id} positive observation targets must be exact reviewed witness tuples`);
      }
    }
    for (const reviewed of support.positive_targets) {
      if (!positiveTargets.some((target) => JSON.stringify(target) === JSON.stringify(reviewed))) {
        errors.push(`${collection.id} lacks exact positive witness ${reviewed.category}:${reviewed.path}`);
      }
    }
    for (const [category] of Object.entries(support.reviewed_absent)) {
      if (observationCoverage.has(category)) errors.push(`${collection.id} invents reviewed-absent observation expectation ${category}`);
    }
    for (const target of forbiddenTargets) {
      if (support.reviewed_absent[target.category]
        && (!exactKeys(target, ['category', 'path'])
          || !support.forbidden_controls.some((control) => control.category === target.category
            && control.path === target.path))) {
        errors.push(`${collection.id} reviewed-absence targets must be canonical exact {category,path} controls`);
      }
    }
    for (const control of support.forbidden_controls) {
      if (!forbiddenTargets.some((target) => target.category === control.category && target.path === control.path)) {
        errors.push(`${collection.id} lacks exact reviewed-absence control ${control.category}:${control.path}`);
      }
    }
    for (const category of OBLIGATION_CATEGORIES) if (!obligationCoverage.has(category)) errors.push(`${collection.id} lacks obligation expectation ${category}`);
  }
  if (!unique(fixture.mutations.map((item) => item.id))) errors.push('fixture mutation ids must be unique');
  const mutationCoverage = new Set(fixture.mutations.map((item) => item.kind));
  for (const kind of MUTATION_KINDS) if (!mutationCoverage.has(kind)) errors.push(`fixture lacks executable mutation ${kind}`);
  for (const mutation of fixture.mutations) {
    const reviewedCase = fixture.cases.find((item) => item.id === mutation.case_id);
    if (!reviewedCase) { errors.push(`mutation ${mutation.id} references an unknown case`); continue; }
    if (mutation.applicability !== MUTATION_APPLICABILITY[mutation.kind]) errors.push(`mutation ${mutation.id} has incoherent applicability`);
    const applicable = {
      selected_workflow: reviewedCase.expected.selected_workflow_ids.length > 0,
      observation: reviewedCase.expected.observations.length > 0,
      forbidden_observation: reviewedCase.expected.forbidden_observations.length > 0,
      obligation: reviewedCase.expected.obligations.length > 0,
      source_ranking: reviewedCase.expected.source_ranking.length > 0,
      multi_workflow: reviewedCase.expected.workflow_outcome === 'multi_workflow'
        && reviewedCase.expected.forbidden_workflow_ids.some((id) => !reviewedCase.expected.selected_workflow_ids.includes(id)),
      replay: true, repository_state: true,
      rename: reviewedCase.repository_scenario.operations.some((operation) => operation.op === 'rename'
        && reviewedCase.expected.forbidden_paths.includes(operation.path)
        && reviewedCase.expected.repository_state.changes.some((change) => change.kind === 'renamed'
          && change.path === operation.to && change.original_path === operation.path)),
      delete: reviewedCase.repository_scenario.operations.some((operation) => operation.op === 'delete'
        && reviewedCase.expected.forbidden_paths.includes(operation.path)
        && reviewedCase.expected.repository_state.changes.some((change) => change.kind === 'deleted'
          && change.path === operation.path && change.original_path === null)),
    }[mutation.applicability];
    if (!applicable) errors.push(`mutation ${mutation.id} is inert for its target case`);
  }
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
  for (const target of item.observations) {
    if (!OBSERVATION_CATEGORIES.includes(target.category)) {
      errors.push(`${at} contains an observation outside the normalized production vocabulary`);
    }
  }
  for (const target of item.obligations) {
    if (!OBLIGATION_CATEGORIES.includes(target.category)) {
      errors.push(`${at} contains an obligation outside the normalized oracle vocabulary`);
    }
  }
  const selectedCount = item.selected_workflow_ids.length;
  if ((item.workflow_outcome === 'selected' && selectedCount !== 1)
    || (item.workflow_outcome === 'multi_workflow' && selectedCount < 2)
    || (['ambiguous', 'new_workflow_required'].includes(item.workflow_outcome) && selectedCount !== 0)) {
    errors.push(`${at} workflow outcome has invalid selected Workflow cardinality`);
  }
  item.repository_state.changes.forEach((change, changeIndex) => {
    if (!isSafeRelativePath(change.path)
      || (change.original_path !== null && !isSafeRelativePath(change.original_path))) {
      errors.push(`${at}.repository_state.changes[${changeIndex}] contains an unsafe path`);
    }
  });
}

export function validateResult(result, { allowUnattested = false, allowVerifiedShape = false } = {}) {
  const errors = [];
  if (!validateResultSchema(result)) return { valid: false, errors: schemaErrors(validateResultSchema) };
  const noClaims = result.claims.end_to_end_runtime === false
    && result.claims.observation === 'not_measured' && result.claims.obligations === 'not_measured'
    && result.claims.source_localization === 'not_measured';
  if (result.evidence_mode === 'oracle_validation') {
    if (result.safety.mode !== 'not_applicable' || !noClaims) errors.push('oracle validation cannot claim runtime safety or measured product evidence');
  } else if (result.safety.mode === 'unattested') {
    if (!allowUnattested) errors.push('measured results require verifier-produced safe-runner attestation');
  } else if (!allowVerifiedShape) {
    errors.push('measured results are gradeable only through a physical controller-report verification');
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
  for (const item of result.materializations) {
    const pin = Object.values(COLLECTION_PINS).find((candidate) => candidate.commit === item.resolved_commit);
    const materializationCollection = {
      repository_url: item.repository_url, commit: item.resolved_commit,
      tree_oid: item.tree_oid, candidate_policy_sha256: item.candidate_policy_sha256,
    };
    if (!pin || item.repository_url !== pin.repository_url || item.tree_oid !== pin.tree_oid
      || item.candidate_policy_sha256 !== CANDIDATE_POLICY_SHA256
      || item.provenance_digest !== materializationProvenanceDigest(materializationCollection, item.scenario_digest)
      || item.base_digest !== materializationBaseDigest(materializationCollection, item.scenario_digest)) {
      errors.push(`materialization ${item.case_id} does not derive from the frozen repository tree, scenario, and candidate policy`);
    }
    if (![item.first_start_digest, item.first_end_digest, item.replay_start_digest,
      item.replay_end_digest].every((value) => value === item.base_digest)) {
      errors.push(`materialization ${item.case_id} does not preserve an identical immutable base across first/replay`);
    }
  }
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

const targetKey = (value) => JSON.stringify(canonical(value));
const mutationExecutors = Object.freeze({
  wrong_workflow(result, index, reviewedCase) {
    const expected = reviewedCase.expected.selected_workflow_ids[0];
    const replacement = reviewedCase.expected.forbidden_workflow_ids[0];
    result.cases[index].selected_workflow_ids = result.cases[index].selected_workflow_ids
      .map((id) => id === expected ? replacement : id);
  },
  missing_observation(result, index, reviewedCase) {
    const expected = targetKey(reviewedCase.expected.observations[0]);
    result.cases[index].observations = result.cases[index].observations.filter((item) => targetKey(item) !== expected);
  },
  unexpected_observation(result, index, reviewedCase) {
    result.cases[index].observations.push(structuredClone(reviewedCase.expected.forbidden_observations[0]));
  },
  lost_obligation(result, index, reviewedCase) {
    const expected = targetKey(reviewedCase.expected.obligations[0]);
    result.cases[index].obligations = result.cases[index].obligations.filter((item) => targetKey(item) !== expected);
  },
  source_ranking_regression(result, index, reviewedCase) {
    const expected = reviewedCase.expected.source_ranking[0];
    result.cases[index].source_ranking = result.cases[index].source_ranking
      .filter((item) => !(item.path === expected.path
        && (expected.symbol === null || item.symbol === expected.symbol)));
  },
  extra_workflow(result, index, reviewedCase) {
    result.cases[index].selected_workflow_ids.push(reviewedCase.expected.forbidden_workflow_ids[0]);
  },
  nondeterministic_replay(result) {
    result.replay_digest = `${result.replay_digest[0] === '0' ? '1' : '0'}${result.replay_digest.slice(1)}`;
  },
  repository_state_mismatch(result, index, reviewedCase) {
    result.cases[index].repository_state.ahead = reviewedCase.expected.repository_state.ahead + 1;
  },
  stale_rename_path(result, index, reviewedCase) {
    const operation = reviewedCase.repository_scenario.operations.find((item) => item.op === 'rename');
    result.cases[index].source_ranking.push({ path: operation.path, symbol: null });
  },
  stale_delete_path(result, index, reviewedCase) {
    const operation = reviewedCase.repository_scenario.operations.find((item) => item.op === 'delete');
    result.cases[index].source_ranking.push({ path: operation.path, symbol: null });
  },
});
export function executeRegisteredMutation(fixture, result, mutation) {
  const executor = mutationExecutors[mutation.kind];
  if (!executor) throw new Error(`unknown registered mutation kind: ${mutation.kind}`);
  const output = structuredClone(result);
  const index = output.cases.findIndex((item) => item.id === mutation.case_id);
  if (index < 0) throw new Error(`mutation case is absent: ${mutation.case_id}`);
  const reviewedCase = fixture.cases.find((item) => item.id === mutation.case_id);
  if (!reviewedCase || mutation.applicability !== MUTATION_APPLICABILITY[mutation.kind]) {
    throw new Error(`mutation ${mutation.id} is not applicable to its reviewed target`);
  }
  executor(output, index, reviewedCase);
  if (mutation.kind !== 'nondeterministic_replay') output.replay_digest = resultCasesDigest(output.cases);
  return output;
}
