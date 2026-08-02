import {
  ADAPTER_SCHEMA,
  RESULT_SCHEMA,
  canonical,
  semanticDigest,
  sortSemantic,
} from '../contract.mjs';

export const CURRENT_GRAPH_ADAPTER = Object.freeze({
  schema: ADAPTER_SCHEMA,
  id: 'lamina-current-graph',
  version: '1',
  input_format: 'lamina-current-semantic-observation/v1',
});

function without(value, excluded) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !excluded.includes(key)));
}

function canonicalMembership(backup) {
  const resources = new Set();
  const relations = new Set();
  for (const version of backup.versions || []) {
    for (const id of [
      ...(version.add_resources || []),
      ...(version.retire_resources || []),
      ...(version.receipt?.active_resources || []),
    ]) resources.add(id);
    for (const id of [
      ...(version.add_statements || []),
      ...(version.retire_statements || []),
      ...(version.receipt?.active_statements || []),
    ]) relations.add(id);
  }
  return { resources, relations };
}

function normalizeValidation(receipt = {}) {
  const validation = receipt.validation || {};
  return {
    mechanically_valid: validation.structural_valid ?? validation.ok ?? false,
    implementation_ready: validation.implementation_ready ?? false,
    verified: validation.verified ?? validation.approved ?? false,
    approved: validation.approved ?? false,
    contradiction_ids: [...(validation.contradictions || receipt.contradictions || [])],
    readiness_gap_codes: [...new Set((validation.readiness_gaps || []).map((item) => item.code))],
  };
}

export function adaptCurrentGraphBackup({
  fixtureId,
  backup,
  publicationAttempts,
  implementationObligations,
  workMap,
  derivedObservations,
}) {
  if (backup?.format !== 'lamina-graph-backup-v1') {
    throw new Error('current graph adapter requires lamina-graph-backup-v1 graph evidence');
  }
  const membership = canonicalMembership(backup);
  const aliases = new Map();
  for (const alias of backup.aliases || []) {
    if (!aliases.has(alias.resource)) aliases.set(alias.resource, []);
    aliases.get(alias.resource).push(alias.key);
  }
  const resources = (backup.resources || [])
    .filter((item) => membership.resources.has(item.id))
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      epistemic_class: item.data?.epistemic_class,
      aliases: aliases.get(item.id) || [],
      attributes: canonical(without(item.data, ['epistemic_class'])),
    }));
  const relations = (backup.statements || [])
    .filter((item) => membership.relations.has(item.id))
    .map((item) => ({
      id: item.id,
      subject_id: item.subject,
      predicate: item.predicate,
      value_kind: item.object ? 'resource' : 'literal',
      object_id: item.object || null,
      literal: item.object ? null : item.literal,
      scope_id: item.scope || null,
      epistemic_class: item.qualifiers?.epistemic_class,
      evidence_ids: [...(item.evidence || [])],
      generated_by_ids: [...(item.generated_by || [])],
      attributes: canonical(without(item.qualifiers, ['epistemic_class'])),
    }));
  const graphVersions = (backup.versions || []).map((item) => ({
    id: item.id,
    source_revision: item.source_revision,
    parent_ids: [...(item.parents || [])],
    added_resource_ids: [...(item.add_resources || [])],
    added_relation_ids: [...(item.add_statements || [])],
    retired_resource_ids: [...(item.retire_resources || [])],
    retired_relation_ids: [...(item.retire_statements || [])],
    active_resource_ids: [...(item.receipt?.active_resources || [])],
    active_relation_ids: [...(item.receipt?.active_statements || [])],
    validation: normalizeValidation(item.receipt),
  }));
  const versionById = new Map(graphVersions.map((item) => [item.id, item]));
  const branches = (backup.views || [])
    .filter((item) => item.kind === 'branch')
    .map((item) => ({
      id: item.id,
      name: item.name,
      head_version_id: item.head,
      source_revision: versionById.get(item.head)?.source_revision || '',
      active_resource_ids: [...(item.resources || [])],
      active_relation_ids: [...(item.statements || [])],
    }));
  const contradictions = (backup.resources || [])
    .filter((item) => membership.resources.has(item.id) && item.kind === 'contradiction')
    .map((item) => ({
      id: item.id,
      type: item.data?.type || 'unknown',
      member_ids: [...(item.data?.members || [])],
    }));
  const relationById = new Map(relations.map((item) => [item.id, item]));
  const workMapById = new Map((workMap?.obligations || []).map((item) => [item.obligation_id, item]));
  const obligations = (implementationObligations || []).map((item) => {
    const relation = item.statement ? relationById.get(item.statement) : null;
    return {
      id: item.obligation_id,
      category: item.type,
      scope_id: item.scope,
      subject_id: item.resource,
      required_relation_ids: item.statement ? [item.statement] : [],
      evidence_ids: [...(relation?.evidence_ids || [])],
      details: canonical(item.details || {}),
      complete: workMapById.get(item.obligation_id)?.status === 'complete',
    };
  });
  const derivedState = (derivedObservations || []).map((item) => ({
    id: item.id,
    kind: item.kind,
    source_version_id: item.source_version_id,
    source_revision: item.catalog_after.source_revision,
    rebuildable: item.catalog_after.authority?.source_localization === 'derived_non_authoritative_index',
    authoritative: item.catalog_after.authority?.source_localization !== 'derived_non_authoritative_index',
    rebuild_digest_before: item.digest_before,
    rebuild_digest_after: item.digest_after,
    canonical_head_before: item.canonical_head_before,
    canonical_head_after: item.canonical_head_after,
  }));
  const semantic = sortSemantic({
    resources,
    relations,
    graph_versions: graphVersions,
    branches,
    contradictions,
    obligations,
    publication_attempts: publicationAttempts,
    derived_state: derivedState,
  });
  return {
    schema: RESULT_SCHEMA,
    fixture_id: fixtureId,
    adapter: CURRENT_GRAPH_ADAPTER,
    semantic,
    semantic_digest: semanticDigest(semantic),
  };
}
