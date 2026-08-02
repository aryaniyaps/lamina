import {
  ADAPTER_SCHEMA,
  RESULT_SCHEMA,
  canonical,
  semanticDigest,
  sortSemantic,
} from '../contract.mjs';
import { digest } from '../../../packages/cli/lib/graph-runtime/util.mjs';
import {
  schemaErrors,
  validateCurrentObservationSchema,
} from '../schema-validation.mjs';

export const CURRENT_GRAPH_ADAPTER = Object.freeze({
  schema: ADAPTER_SCHEMA,
  id: 'lamina-current-graph',
  version: '1',
  input_format: 'lamina.current-semantic-observation/v1',
});
export const CURRENT_OBSERVATION_SCHEMA = 'lamina.current-semantic-observation/v1';

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

function normalizePublicationReceipt(receipt) {
  const errorCode = receipt.error?.code || null;
  let outcome;
  if (receipt.result && typeof receipt.result.graph_version === 'string') outcome = 'published';
  else if (errorCode === 'LAMINA_VALIDATION_FAILED') outcome = 'validation_failed';
  else if (errorCode === 'LAMINA_COMPARE_AND_SWAP_FAILED') outcome = 'compare_and_swap_failed';
  else if (errorCode === 'LAMINA_INJECTED_INTERRUPTION') outcome = 'interrupted';
  else throw new Error(`current graph adapter rejected unknown publication outcome ${errorCode || '<missing>'}`);
  return {
    id: receipt.id,
    branch_id: receipt.branch_id,
    base_version_id: receipt.before.session_base_version_id,
    outcome,
    result_version_id: receipt.result?.graph_version || null,
    error_code: errorCode,
    head_version_id_after: receipt.after.head_version_id,
    visible_resource_ids: [...receipt.after.visible_resource_ids],
    visible_relation_ids: [...receipt.after.visible_relation_ids],
  };
}

function normalizeCliReceipt(receipt) {
  const error = receipt.stderr?.error || null;
  let result = null;
  let details = {};
  if (receipt.exit_code === 0) {
    if (receipt.operation === 'graph.status') {
      result = {
        branch: receipt.stdout.branch,
        graph_version: receipt.stdout.graph_version,
        source_revision: receipt.stdout.source_revision,
        stale: receipt.stdout.stale,
      };
    } else if (receipt.operation.startsWith('graph.query.')) {
      result = {
        graph_version: receipt.stdout.graph_version?.id || receipt.stdout.graph_version,
        resource_ids: (receipt.stdout.resources || []).map((item) => item.id),
      };
    } else if (receipt.operation === 'graph.backup') {
      result = { digest: receipt.stdout.digest };
    } else if (receipt.operation === 'graph.restore') {
      result = {
        restored: receipt.stdout.restored,
        resources: receipt.stdout.resources,
        statements: receipt.stdout.statements,
        versions: receipt.stdout.versions,
        views: receipt.stdout.views,
      };
    } else if (receipt.operation === 'work.map') {
      result = {
        schema: receipt.stdout.schema,
        obligation_count: receipt.stdout.obligations.length,
        resolution_statuses: [...new Set(receipt.stdout.obligations
          .map((item) => item.status))].sort(),
      };
    } else if (receipt.operation === 'work.check') {
      result = {
        schema: receipt.stdout.schema,
        packet_id: receipt.stdout.packet_id,
        work_map_digest: receipt.stdout.work_map_digest,
      };
    } else {
      throw new Error(`current graph adapter does not normalize CLI operation ${receipt.operation}`);
    }
  } else if (receipt.operation === 'session.publish.invalid') {
    details = {
      error_messages: [...(error?.details?.errors || [])].sort(),
      contradiction_ids: [...(error?.details?.contradictions || [])].sort(),
      readiness_gap_codes: [...new Set((error?.details?.readiness_gaps || [])
        .map((item) => item.code))].sort(),
      readiness_gap_resource_ids: [...new Set((error?.details?.readiness_gaps || [])
        .map((item) => item.resource).filter(Boolean))].sort(),
    };
  } else if (receipt.operation === 'work.check.unresolved') {
    details = {
      duplicates: error?.details?.duplicates,
      invalid_obligation_ids: [...(error?.details?.invalid || [])].sort(),
      missing_obligation_ids: [...(error?.details?.missing || [])].sort(),
      unknown_obligation_ids: [...(error?.details?.unknown || [])].sort(),
    };
  } else if (receipt.operation === 'graph.restore.tampered') {
    details = {
      expected_digest: error?.details?.expected,
      actual_digest: error?.details?.actual,
    };
  } else if (receipt.exit_code !== 0) {
    details = canonical(error?.details || {});
  }
  return {
    id: receipt.id,
    operation: receipt.operation,
    branch: receipt.branch,
    ok: receipt.exit_code === 0,
    result: result === null ? null : canonical(result),
    error_code: error?.code || null,
    reason: error?.message || null,
    details: canonical(details),
  };
}

function validateObservationBoundary(observation) {
  if (!validateCurrentObservationSchema(observation)) {
    throw new Error(`current graph adapter rejected malformed observation: ${schemaErrors(validateCurrentObservationSchema).join('; ')}`);
  }
  if (observation?.schema !== CURRENT_OBSERVATION_SCHEMA) {
    throw new Error(`current graph adapter requires ${CURRENT_OBSERVATION_SCHEMA}`);
  }
  const {
    fixture_id: fixtureId,
    graph_backup: backup,
    publication_receipts: publicationAttempts,
    implementation_obligations: implementationObligations,
    work_started_receipt: workStarted,
    cli_receipts: cliReceipts,
    derived_observations: derivedObservations,
  } = observation;
  for (const [name, value] of Object.entries({
    publication_receipts: publicationAttempts,
    implementation_obligations: implementationObligations,
    cli_receipts: cliReceipts,
    derived_observations: derivedObservations,
  })) {
    if (!Array.isArray(value)) throw new Error(`current graph adapter requires ${name} array`);
  }
  if (typeof fixtureId !== 'string' || !fixtureId) {
    throw new Error('current graph adapter requires a non-empty fixture_id');
  }
  if (backup?.format !== 'lamina-graph-backup-v1') {
    throw new Error('current graph adapter requires lamina-graph-backup-v1 graph evidence');
  }
  const { integrity, ...backupBody } = backup;
  if (typeof integrity !== 'string' || integrity !== digest('backup', backupBody)) {
    throw new Error('current graph adapter rejected graph backup with invalid integrity');
  }
}

function adaptCurrentGraphBackupUnsafe(observation) {
  const {
    fixture_id: fixtureId,
    graph_backup: backup,
    publication_receipts: publicationAttempts,
    implementation_obligations: implementationObligations,
    work_started_receipt: workStarted,
    cli_receipts: cliReceipts,
    derived_observations: derivedObservations,
  } = observation;
  if (workStarted?.schema !== 'lamina.work-started/v4' || !workStarted.work_map) {
    throw new Error('current graph adapter requires an accepted lamina.work-started/v4 receipt');
  }
  if (workStarted.packet_id !== workStarted.work_map.packet_id) {
    throw new Error('current graph adapter rejected mismatched WorkStarted packet identity');
  }
  if (workStarted.work_map_digest !== digest('work_map', workStarted.work_map)) {
    throw new Error('current graph adapter rejected mismatched WorkStarted map digest');
  }
  const checkedReceipt = cliReceipts.find((item) =>
    item.operation === 'work.check' && item.exit_code === 0);
  if (checkedReceipt?.stdout?.packet_id !== workStarted.packet_id
    || checkedReceipt?.stdout?.work_map_digest !== workStarted.work_map_digest) {
    throw new Error('current graph adapter rejected CLI WorkStarted evidence mismatch');
  }
  const obligationIds = implementationObligations.map((item) => item.obligation_id).sort();
  const mappedIds = (workStarted.work_map.obligations || [])
    .map((item) => item.obligation_id).sort();
  if (JSON.stringify(obligationIds) !== JSON.stringify(mappedIds)) {
    throw new Error('current graph adapter rejected WorkStarted obligation identity mismatch');
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
  const workMapById = new Map((workStarted.work_map.obligations || [])
    .map((item) => [item.obligation_id, item]));
  const obligations = (implementationObligations || []).map((item) => {
    const relation = item.statement ? relationById.get(item.statement) : null;
    const resolution = workMapById.get(item.obligation_id);
    if (!resolution || !['already_satisfied', 'change_required'].includes(resolution.status)) {
      throw new Error(`current graph adapter requires a checked resolution for ${item.obligation_id}`);
    }
    return {
      id: item.obligation_id,
      category: item.type,
      scope_id: item.scope,
      subject_id: item.resource,
      required_relation_ids: item.statement ? [item.statement] : [],
      evidence_ids: [...(relation?.evidence_ids || [])],
      details: canonical(item.details || {}),
      resolution_status: resolution.status,
      current_evidence: [...resolution.current_evidence],
      files: resolution.files.map((file) => ({
        path: file.path,
        action: file.action,
        role: file.role,
      })),
      complete: resolution.status === 'already_satisfied',
    };
  });
  const cliOutcomes = cliReceipts.map(normalizeCliReceipt);
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
    publication_attempts: publicationAttempts.map(normalizePublicationReceipt),
    cli_outcomes: cliOutcomes,
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

export function adaptCurrentGraphBackup(observation) {
  validateObservationBoundary(observation);
  try {
    return adaptCurrentGraphBackupUnsafe(observation);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `current graph adapter rejected malformed observation: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}
