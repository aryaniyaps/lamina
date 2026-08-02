import {
  ADAPTER_SCHEMA,
  COLLECTIONS,
  EPISTEMIC_CLASSES,
  FIXTURE_SCHEMA,
  REQUIRED_CASE_CATEGORIES,
  RESULT_SCHEMA,
  compareStrings,
  relationSortKey,
  semanticDigest,
} from './contract.mjs';
import {
  schemaErrors,
  validateFixtureSchema,
  validateResultSchema,
} from './schema-validation.mjs';

export class SemanticOracleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SemanticOracleError';
    this.code = code;
    this.details = details;
  }
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const unique = (value) => new Set(value).size === value.length;

function exactKeys(value, keys) {
  return object(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validateIdCollection(value, name, errors) {
  if (!Array.isArray(value)) {
    errors.push(`$.semantic.${name} must be an array`);
    return;
  }
  if (value.some((item) => !object(item) || typeof item.id !== 'string' || !item.id)) {
    errors.push(`$.semantic.${name} entries need non-empty ids`);
    return;
  }
  const ids = value.map((item) => item.id);
  if (!unique(ids)) errors.push(`$.semantic.${name} ids must be unique`);
  const keys = name === 'relations' ? value.map(relationSortKey) : ids;
  if (JSON.stringify(keys) !== JSON.stringify([...keys].sort(compareStrings))) {
    errors.push(`$.semantic.${name} must use deterministic ordering`);
  }
}

export function validateSemantic(semantic) {
  const errors = [];
  if (!exactKeys(semantic, COLLECTIONS)) {
    errors.push(`$.semantic must contain exactly ${COLLECTIONS.join(', ')}`);
    return errors;
  }
  for (const name of COLLECTIONS) validateIdCollection(semantic[name], name, errors);
  if (COLLECTIONS.some((name) => !Array.isArray(semantic[name]))) return errors;
  if (COLLECTIONS.some((name) => semantic[name].some((item) =>
    !object(item) || typeof item.id !== 'string' || !item.id))) return errors;

  const resourceIds = new Set(semantic.resources.map((item) => item.id));
  const relationIds = new Set(semantic.relations.map((item) => item.id));
  const versionIds = new Set(semantic.graph_versions.map((item) => item.id));
  const contradictionIds = new Set(semantic.contradictions.map((item) => item.id));
  const versionById = new Map(semantic.graph_versions.map((item) => [item.id, item]));

  for (const resource of semantic.resources) {
    if (!exactKeys(resource, ['id', 'kind', 'epistemic_class', 'aliases', 'attributes'])
      || typeof resource.kind !== 'string' || !EPISTEMIC_CLASSES.includes(resource.epistemic_class)
      || !strings(resource.aliases) || !unique(resource.aliases) || !object(resource.attributes)) {
      errors.push(`resource ${resource.id} has an invalid normalized shape`);
    }
  }
  for (const relation of semantic.relations) {
    const validShape = exactKeys(relation, [
      'id', 'subject_id', 'predicate', 'value_kind', 'object_id', 'literal', 'scope_id',
      'epistemic_class', 'evidence_ids', 'generated_by_ids', 'attributes',
    ]) && resourceIds.has(relation.subject_id) && ['resource', 'literal'].includes(relation.value_kind)
      && !(relation.value_kind === 'resource'
        && (!resourceIds.has(relation.object_id) || relation.literal !== null))
      && !(relation.value_kind === 'literal' && relation.object_id !== null)
      && !(relation.scope_id !== null && !resourceIds.has(relation.scope_id))
      && EPISTEMIC_CLASSES.includes(relation.epistemic_class)
      && strings(relation.evidence_ids) && unique(relation.evidence_ids)
      && !relation.evidence_ids.some((id) => !resourceIds.has(id))
      && object(relation.attributes);
    if (!validShape) {
      errors.push(`relation ${relation.id} has an invalid normalized shape or dangling reference`);
      continue;
    }
    if (!strings(relation.generated_by_ids) || !unique(relation.generated_by_ids)
      || relation.generated_by_ids.some((id) => !resourceIds.has(id))) {
      errors.push(`relation ${relation.id} has invalid generator provenance`);
    }
  }
  for (const version of semantic.graph_versions) {
    const listFields = [
      'parent_ids', 'added_resource_ids', 'added_relation_ids', 'retired_resource_ids',
      'retired_relation_ids', 'active_resource_ids', 'active_relation_ids',
    ];
    if (!exactKeys(version, ['id', 'source_revision', ...listFields, 'validation'])
      || typeof version.source_revision !== 'string'
      || listFields.some((field) => !strings(version[field]) || !unique(version[field]))) {
      errors.push(`graph version ${version.id} has an invalid normalized shape`);
      continue;
    }
    if (version.parent_ids.some((id) => !versionIds.has(id))
      || [...version.added_resource_ids, ...version.retired_resource_ids, ...version.active_resource_ids]
        .some((id) => !resourceIds.has(id))
      || [...version.added_relation_ids, ...version.retired_relation_ids, ...version.active_relation_ids]
        .some((id) => !relationIds.has(id))) {
      errors.push(`graph version ${version.id} has a dangling lineage or membership reference`);
    }
    for (const [added, retired] of [
      [version.added_resource_ids, version.retired_resource_ids],
      [version.added_relation_ids, version.retired_relation_ids],
    ]) {
      if (added.some((id) => retired.includes(id))) {
        errors.push(`graph version ${version.id} adds and retires the same semantic id`);
      }
    }
    if (version.parent_ids.every((id) => versionById.has(id))) {
      const expectedResources = new Set(version.parent_ids.flatMap((id) => versionById.get(id).active_resource_ids));
      const expectedRelations = new Set(version.parent_ids.flatMap((id) => versionById.get(id).active_relation_ids));
      version.retired_resource_ids.forEach((id) => expectedResources.delete(id));
      version.retired_relation_ids.forEach((id) => expectedRelations.delete(id));
      version.added_resource_ids.forEach((id) => expectedResources.add(id));
      version.added_relation_ids.forEach((id) => expectedRelations.add(id));
      if (JSON.stringify([...expectedResources].sort(compareStrings)) !== JSON.stringify(version.active_resource_ids)
        || JSON.stringify([...expectedRelations].sort(compareStrings)) !== JSON.stringify(version.active_relation_ids)) {
        errors.push(`graph version ${version.id} active closure contradicts its parent deltas`);
      }
    }
    const validation = version.validation;
    if (!exactKeys(validation, [
      'mechanically_valid', 'implementation_ready', 'verified', 'approved',
      'contradiction_ids', 'readiness_gap_codes',
    ]) || ['mechanically_valid', 'implementation_ready', 'verified', 'approved']
      .some((field) => typeof validation[field] !== 'boolean')
      || !strings(validation.contradiction_ids) || !strings(validation.readiness_gap_codes)
      || validation.contradiction_ids.some((id) => !contradictionIds.has(id))) {
      errors.push(`graph version ${version.id} has invalid validation semantics`);
    }
  }
  for (const branch of semantic.branches) {
    if (!exactKeys(branch, [
      'id', 'name', 'head_version_id', 'source_revision', 'active_resource_ids', 'active_relation_ids',
    ]) || !versionIds.has(branch.head_version_id) || typeof branch.name !== 'string'
      || typeof branch.source_revision !== 'string' || !strings(branch.active_resource_ids)
      || !strings(branch.active_relation_ids)
      || branch.active_resource_ids.some((id) => !resourceIds.has(id))
      || branch.active_relation_ids.some((id) => !relationIds.has(id))) {
      errors.push(`branch ${branch.id} has an invalid head or active closure`);
      continue;
    }
  }
  const branchById = new Map(semantic.branches.map((item) => [item.id, item]));
  for (const branch of semantic.branches) {
    const head = versionById.get(branch.head_version_id);
    if (head && (JSON.stringify(branch.active_resource_ids) !== JSON.stringify(head.active_resource_ids)
      || JSON.stringify(branch.active_relation_ids) !== JSON.stringify(head.active_relation_ids))) {
      errors.push(`branch ${branch.id} closure does not match its head GraphVersion`);
    }
  }
  for (const contradiction of semantic.contradictions) {
    if (!exactKeys(contradiction, ['id', 'type', 'member_ids'])
      || typeof contradiction.type !== 'string' || !strings(contradiction.member_ids)
      || contradiction.member_ids.length < 2
      || contradiction.member_ids.some((id) => !relationIds.has(id) && !resourceIds.has(id))) {
      errors.push(`contradiction ${contradiction.id} has invalid members`);
    }
  }
  for (const obligation of semantic.obligations) {
    if (!exactKeys(obligation, [
      'id', 'category', 'scope_id', 'subject_id', 'required_relation_ids',
      'evidence_ids', 'details', 'resolution_status', 'current_evidence', 'files', 'complete',
    ]) || typeof obligation.category !== 'string' || !resourceIds.has(obligation.scope_id)
      || !resourceIds.has(obligation.subject_id)
      || !strings(obligation.required_relation_ids) || !strings(obligation.evidence_ids)
      || obligation.required_relation_ids.some((id) => !relationIds.has(id))
      || obligation.evidence_ids.some((id) => !resourceIds.has(id))
      || !object(obligation.details)
      || !['already_satisfied', 'change_required'].includes(obligation.resolution_status)
      || !strings(obligation.current_evidence) || !unique(obligation.current_evidence)
      || !Array.isArray(obligation.files) || obligation.files.some((file) =>
        !exactKeys(file, ['path', 'action', 'role']) || typeof file.path !== 'string'
        || !['modify', 'create'].includes(file.action)
        || !['implementation', 'test'].includes(file.role))
      || typeof obligation.complete !== 'boolean') {
      errors.push(`obligation ${obligation.id} has invalid completeness semantics`);
      continue;
    }
    if (obligation.complete !== (obligation.resolution_status === 'already_satisfied')
      || (obligation.resolution_status === 'already_satisfied' && !obligation.current_evidence.length)
      || (obligation.resolution_status === 'change_required'
        && !obligation.files.some((file) => file.role === 'implementation'))) {
      errors.push(`obligation ${obligation.id} contradicts its checked WorkMap resolution`);
    }
  }
  const attemptOutcomes = new Set([
    'published', 'validation_failed', 'interrupted', 'compare_and_swap_failed',
  ]);
  for (const attempt of semantic.publication_attempts) {
    if (!exactKeys(attempt, [
      'id', 'branch_id', 'base_version_id', 'outcome', 'result_version_id', 'error_code',
      'head_version_id_after', 'visible_resource_ids', 'visible_relation_ids',
    ]) || !attemptOutcomes.has(attempt.outcome) || !branchById.has(attempt.branch_id)
      || !versionIds.has(attempt.base_version_id)
      || !versionIds.has(attempt.head_version_id_after)
      || (attempt.result_version_id !== null && !versionIds.has(attempt.result_version_id))
      || (attempt.error_code !== null && typeof attempt.error_code !== 'string')
      || !strings(attempt.visible_resource_ids) || !strings(attempt.visible_relation_ids)
      || attempt.visible_resource_ids.some((id) => !resourceIds.has(id))
      || attempt.visible_relation_ids.some((id) => !relationIds.has(id))) {
      errors.push(`publication attempt ${attempt.id} has invalid atomicity semantics`);
      continue;
    }
    const observedHead = versionById.get(attempt.head_version_id_after);
    if (observedHead && (JSON.stringify(attempt.visible_resource_ids) !== JSON.stringify(observedHead.active_resource_ids)
      || JSON.stringify(attempt.visible_relation_ids) !== JSON.stringify(observedHead.active_relation_ids))) {
      errors.push(`publication attempt ${attempt.id} visibility does not match its observed head`);
    }
    if (attempt.outcome === 'published'
      ? (attempt.result_version_id === null || attempt.error_code !== null
        || attempt.result_version_id !== attempt.head_version_id_after)
      : (attempt.result_version_id !== null || typeof attempt.error_code !== 'string')) {
      errors.push(`publication attempt ${attempt.id} has contradictory outcome fields`);
    }
    if (['validation_failed', 'interrupted'].includes(attempt.outcome)
      && attempt.head_version_id_after !== attempt.base_version_id) {
      errors.push(`publication attempt ${attempt.id} exposed a partial head`);
    }
  }
  for (const outcome of semantic.cli_outcomes) {
    if (!exactKeys(outcome, [
      'id', 'operation', 'branch', 'ok', 'result', 'error_code', 'reason', 'details',
    ]) || typeof outcome.operation !== 'string' || typeof outcome.branch !== 'string'
      || typeof outcome.ok !== 'boolean' || !object(outcome.details)
      || (outcome.ok
        ? (!object(outcome.result) || outcome.error_code !== null || outcome.reason !== null
          || Object.keys(outcome.details).length !== 0)
        : (outcome.result !== null || typeof outcome.error_code !== 'string'
          || typeof outcome.reason !== 'string'))) {
      errors.push(`CLI outcome ${outcome.id} has contradictory success or failure semantics`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const parent of versionById.get(id)?.parent_ids || []) if (!visit(parent)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  if ([...versionIds].some((id) => !visit(id))) errors.push('GraphVersion lineage must be acyclic');
  const reachable = new Set();
  const mark = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const parent of versionById.get(id)?.parent_ids || []) mark(parent);
  };
  semantic.branches.forEach((branch) => mark(branch.head_version_id));
  if ([...versionIds].some((id) => !reachable.has(id))) {
    errors.push('every normalized GraphVersion must be reachable from a branch head');
  }
  for (const state of semantic.derived_state) {
    if (!exactKeys(state, [
      'id', 'kind', 'source_version_id', 'source_revision', 'rebuildable', 'authoritative',
      'rebuild_digest_before', 'rebuild_digest_after', 'canonical_head_before', 'canonical_head_after',
    ]) || typeof state.kind !== 'string' || !versionIds.has(state.source_version_id)
      || typeof state.source_revision !== 'string'
      || typeof state.rebuildable !== 'boolean' || typeof state.authoritative !== 'boolean'
      || typeof state.rebuild_digest_before !== 'string' || typeof state.rebuild_digest_after !== 'string'
      || !versionIds.has(state.canonical_head_before) || !versionIds.has(state.canonical_head_after)) {
      errors.push(`derived state ${state.id} has an invalid authority boundary`);
      continue;
    }
    if (state.rebuildable && (state.rebuild_digest_before !== state.rebuild_digest_after
      || state.canonical_head_before !== state.canonical_head_after
      || state.canonical_head_after !== state.source_version_id)) {
      errors.push(`derived state ${state.id} rebuild changed semantics or canonical authority`);
    }
    if (state.authoritative) errors.push(`derived state ${state.id} cannot be canonical product authority`);
  }
  return errors;
}

export function validateResult(result) {
  const errors = [];
  if (!validateResultSchema(result)) errors.push(...schemaErrors(validateResultSchema));
  if (!exactKeys(result, ['schema', 'fixture_id', 'adapter', 'semantic', 'semantic_digest'])
    || result.schema !== RESULT_SCHEMA || typeof result.fixture_id !== 'string'
    || !exactKeys(result.adapter, ['schema', 'id', 'version', 'input_format'])
    || result.adapter.schema !== ADAPTER_SCHEMA
    || ['id', 'version', 'input_format'].some((field) => typeof result.adapter[field] !== 'string')) {
    errors.push('normalized result envelope is invalid');
    return { valid: false, errors };
  }
  errors.push(...validateSemantic(result.semantic));
  if (result.semantic_digest !== semanticDigest(result.semantic)) {
    errors.push('semantic_digest does not match normalized semantic content');
  }
  return { valid: errors.length === 0, errors };
}

export function validateFixture(fixture) {
  const errors = [];
  if (!validateFixtureSchema(fixture)) errors.push(...schemaErrors(validateFixtureSchema));
  if (!exactKeys(fixture, [
    'schema', 'id', 'description', 'expected', 'forbidden', 'cases', 'mutations',
  ]) || fixture.schema !== FIXTURE_SCHEMA || typeof fixture.id !== 'string'
    || typeof fixture.description !== 'string') {
    errors.push('fixture envelope is invalid');
    return { valid: false, errors };
  }
  errors.push(...validateSemantic(fixture.expected));
  if (!Array.isArray(fixture.forbidden) || fixture.forbidden.some((item) =>
    !exactKeys(item, ['collection', 'id', 'reason']) || !COLLECTIONS.includes(item.collection)
    || typeof item.id !== 'string' || typeof item.reason !== 'string')) {
    errors.push('fixture forbidden outcomes are invalid');
  }
  if (Array.isArray(fixture.forbidden)
    && !unique(fixture.forbidden.filter(object)
      .map((item) => `${item.collection}:${item.id}`))) {
    errors.push('fixture forbidden outcomes must be unique');
  }
  if (!Array.isArray(fixture.mutations) || fixture.mutations.some((item) =>
    !exactKeys(item, [
      'id', 'category', 'description', 'expected_classification', 'diagnostic_includes',
    ]) || typeof item.id !== 'string'
    || !REQUIRED_CASE_CATEGORIES.includes(item.category) || typeof item.description !== 'string'
    || !['candidate_invalid', 'product_regression'].includes(item.expected_classification)
    || !strings(item.diagnostic_includes) || !item.diagnostic_includes.length
    || !unique(item.diagnostic_includes))
    || !unique(fixture.mutations.map((item) => item.id))) {
    errors.push('fixture mutation registry is invalid');
  }
  const mutationIds = new Set(Array.isArray(fixture.mutations)
    ? fixture.mutations.filter(object).map((item) => item.id)
    : []);
  if (!Array.isArray(fixture.cases) || fixture.cases.some((item) =>
    !exactKeys(item, ['id', 'category', 'polarity', 'target', 'rationale'])
    || typeof item.id !== 'string' || !REQUIRED_CASE_CATEGORIES.includes(item.category)
    || !['positive', 'negative'].includes(item.polarity) || !object(item.target)
    || typeof item.rationale !== 'string'
    || (item.polarity === 'positive' && (
      !exactKeys(item.target, ['kind', 'collection', 'field', 'value'])
      || item.target.kind !== 'expected' || !COLLECTIONS.includes(item.target.collection)
      || typeof item.target.field !== 'string'
    ))
    || (item.polarity === 'negative' && (
      !exactKeys(item.target, ['kind', 'id']) || item.target.kind !== 'mutation'
      || !mutationIds.has(item.target.id)
    )))) {
    errors.push('fixture case matrix is invalid');
  }
  if (Array.isArray(fixture.cases)
    && !unique(fixture.cases.filter(object).map((item) => item.id))) {
    errors.push('fixture case ids must be unique');
  }
  if (Array.isArray(fixture.cases)) {
    for (const category of REQUIRED_CASE_CATEGORIES) {
      for (const polarity of ['positive', 'negative']) {
        if (!fixture.cases.some((item) => item?.category === category
          && item.polarity === polarity)) {
          errors.push(`fixture case matrix lacks ${polarity} coverage for ${category}`);
        }
      }
    }
    for (const item of fixture.cases.filter((candidate) => candidate?.polarity === 'positive'
      && object(candidate.target) && typeof candidate.target.collection === 'string'
      && typeof candidate.target.field === 'string')) {
      const target = item.target;
      const matched = fixture.expected?.[target.collection]?.some((candidate) => {
        const actual = target.field.split('.').reduce((value, key) => value?.[key], candidate);
        return Array.isArray(actual) ? actual.includes(target.value) : Object.is(actual, target.value);
      });
      if (!matched) errors.push(`fixture positive case ${item.id} target does not exist`);
    }
  }
  for (const mutation of Array.isArray(fixture.mutations)
    ? fixture.mutations.filter(object)
    : []) {
    if (!Array.isArray(fixture.cases) || !fixture.cases.some((item) => item?.polarity === 'negative'
      && item.target?.id === mutation.id && item.category === mutation.category)) {
      errors.push(`fixture mutation ${mutation.id} lacks a matching negative case`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidFixture(fixture) {
  const validation = validateFixture(fixture);
  if (!validation.valid) {
    throw new SemanticOracleError('LAMINA_SEMANTIC_FIXTURE_INVALID', 'Reviewed semantic fixture is invalid.', {
      errors: validation.errors,
    });
  }
  return fixture;
}
