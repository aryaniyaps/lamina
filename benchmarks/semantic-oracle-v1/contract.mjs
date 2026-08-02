import crypto from 'node:crypto';

export const RESULT_SCHEMA = 'lamina.semantic-result/v1';
export const FIXTURE_SCHEMA = 'lamina.semantic-fixture/v1';
export const ADAPTER_SCHEMA = 'lamina.semantic-adapter/v1';

export const REQUIRED_CASE_CATEGORIES = Object.freeze([
  'resources',
  'relations',
  'graph_versions',
  'lineage',
  'provenance',
  'contradictions',
  'atomic_publication',
  'epistemic_separation',
  'actors_personas',
  'workflows',
  'states_transitions',
  'permissions',
  'invariants',
  'failures_decisions',
  'verification_evidence',
  'branch_worktree_isolation',
  'concurrent_updates',
  'determinism',
  'graph_closure',
  'derived_state',
  'implementation_obligations',
  'completeness',
  'cli_outcomes',
]);

export const COLLECTIONS = Object.freeze([
  'resources',
  'relations',
  'graph_versions',
  'branches',
  'contradictions',
  'obligations',
  'publication_attempts',
  'cli_outcomes',
  'derived_state',
]);

export const EPISTEMIC_CLASSES = Object.freeze([
  'intended',
  'observed',
  'inferred',
  'simulated',
  'human_evidence',
  'runtime_evidence',
]);

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function semanticDigest(value) {
  return `semantic_${crypto.createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')}`;
}

export function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function relationSortKey(relation) {
  return [
    relation.subject_id,
    relation.predicate,
    relation.object_id || '',
    relation.value_kind,
    JSON.stringify(relation.literal),
    relation.scope_id || '',
    relation.id,
  ].join('\u0000');
}

export function sortSemantic(semantic) {
  const sorted = canonical(structuredClone(semantic));
  for (const collection of COLLECTIONS) {
    if (!Array.isArray(sorted[collection])) continue;
    sorted[collection].sort((left, right) => {
      if (collection === 'relations') return compareStrings(relationSortKey(left), relationSortKey(right));
      return compareStrings(left.id, right.id);
    });
  }
  for (const item of sorted.resources || []) item.aliases.sort();
  for (const item of sorted.relations || []) item.evidence_ids.sort();
  for (const item of sorted.relations || []) item.generated_by_ids.sort();
  for (const item of sorted.graph_versions || []) {
    for (const field of [
      'parent_ids', 'added_resource_ids', 'added_relation_ids', 'retired_resource_ids',
      'retired_relation_ids', 'active_resource_ids', 'active_relation_ids',
    ]) item[field].sort();
    item.validation.contradiction_ids.sort();
    item.validation.readiness_gap_codes.sort();
  }
  for (const item of sorted.branches || []) {
    item.active_resource_ids.sort();
    item.active_relation_ids.sort();
  }
  for (const item of sorted.contradictions || []) item.member_ids.sort();
  for (const item of sorted.obligations || []) {
    item.required_relation_ids.sort();
    item.evidence_ids.sort();
    item.current_evidence.sort();
    item.files.sort((left, right) => compareStrings(
      `${left.path}\u0000${left.action}\u0000${left.role}`,
      `${right.path}\u0000${right.action}\u0000${right.role}`,
    ));
  }
  for (const item of sorted.publication_attempts || []) {
    item.visible_resource_ids.sort();
    item.visible_relation_ids.sort();
  }
  return sorted;
}
