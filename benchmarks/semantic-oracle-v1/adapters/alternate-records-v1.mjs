import {
  ADAPTER_SCHEMA,
  RESULT_SCHEMA,
  semanticDigest,
  sortSemantic,
} from '../contract.mjs';

export const ALTERNATE_RECORDS_ADAPTER = Object.freeze({
  schema: ADAPTER_SCHEMA,
  id: 'alternate-records-example',
  version: '1',
  input_format: 'example.alternate-semantic-records/v1',
});

const ids = (value) => [...(value || [])];

export function adaptAlternateRecords(raw) {
  if (raw?.format !== ALTERNATE_RECORDS_ADAPTER.input_format) {
    throw new Error(`alternate records adapter requires ${ALTERNATE_RECORDS_ADAPTER.input_format}`);
  }
  const semantic = sortSemantic({
    resources: raw.vertices.map((item) => ({
      id: item.key,
      kind: item.type,
      epistemic_class: item.truth_class,
      aliases: ids(item.names),
      attributes: item.properties,
    })),
    relations: raw.arcs.map((item) => ({
      id: item.key,
      subject_id: item.from,
      predicate: item.label,
      value_kind: item.target.tag === 'ref' ? 'resource' : 'literal',
      object_id: item.target.tag === 'ref' ? item.target.value : null,
      literal: item.target.tag === 'literal' ? item.target.value : null,
      scope_id: item.context,
      epistemic_class: item.truth_class,
      evidence_ids: ids(item.support),
      generated_by_ids: ids(item.generators),
      attributes: item.properties,
    })),
    graph_versions: raw.revisions.map((item) => ({
      id: item.key,
      source_revision: item.source,
      parent_ids: ids(item.ancestors),
      added_resource_ids: ids(item.resource_delta.add),
      added_relation_ids: ids(item.relation_delta.add),
      retired_resource_ids: ids(item.resource_delta.remove),
      retired_relation_ids: ids(item.relation_delta.remove),
      active_resource_ids: ids(item.closure.resources),
      active_relation_ids: ids(item.closure.relations),
      validation: {
        mechanically_valid: item.gates.structural,
        implementation_ready: item.gates.ready,
        verified: item.gates.verified,
        approved: item.gates.approved,
        contradiction_ids: ids(item.gates.conflicts),
        readiness_gap_codes: ids(item.gates.gaps),
      },
    })),
    branches: raw.pointers.map((item) => ({
      id: item.key,
      name: item.label,
      head_version_id: item.revision,
      source_revision: item.source,
      active_resource_ids: ids(item.closure.resources),
      active_relation_ids: ids(item.closure.relations),
    })),
    contradictions: raw.conflicts.map((item) => ({
      id: item.key,
      type: item.class,
      member_ids: ids(item.members),
    })),
    obligations: raw.requirements.map((item) => ({
      id: item.key,
      category: item.class,
      scope_id: item.context,
      subject_id: item.subject,
      required_relation_ids: ids(item.required_arcs),
      evidence_ids: ids(item.support),
      details: item.contract,
      resolution_status: item.resolution.state,
      current_evidence: ids(item.resolution.current),
      files: item.resolution.targets.map((target) => ({
        path: target.file,
        action: target.change,
        role: target.purpose,
      })),
      complete: item.resolution.done,
    })),
    publication_attempts: raw.transactions.map((item) => ({
      id: item.key,
      branch_id: item.pointer,
      base_version_id: item.base,
      outcome: item.state,
      result_version_id: item.result,
      error_code: item.failure,
      head_version_id_after: item.observed_head,
      visible_resource_ids: ids(item.visible.resources),
      visible_relation_ids: ids(item.visible.relations),
    })),
    cli_outcomes: raw.commands.map((item) => ({
      id: item.key,
      operation: item.name,
      branch: item.pointer,
      ok: item.status === 'ok',
      result: item.payload,
      error_code: item.problem?.code || null,
      reason: item.problem?.reason || null,
      details: item.problem?.context || {},
    })),
    derived_state: raw.projections.map((item) => ({
      id: item.key,
      kind: item.type,
      source_version_id: item.revision,
      source_revision: item.source,
      rebuildable: item.disposable,
      authoritative: item.authority === 'canonical',
      rebuild_digest_before: item.digests.before,
      rebuild_digest_after: item.digests.after,
      canonical_head_before: item.heads.before,
      canonical_head_after: item.heads.after,
    })),
  });
  return {
    schema: RESULT_SCHEMA,
    fixture_id: raw.case_key,
    adapter: ALTERNATE_RECORDS_ADAPTER,
    semantic,
    semantic_digest: semanticDigest(semantic),
  };
}
