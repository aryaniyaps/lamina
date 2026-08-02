#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digest } from '../packages/cli/lib/graph-runtime/util.mjs';
import {
  runCurrentFixture,
  runCurrentObservation,
} from '../benchmarks/semantic-oracle-v1/run-current-fixture.mjs';
import { semanticDigest } from '../benchmarks/semantic-oracle-v1/contract.mjs';
import { validateResult } from '../benchmarks/semantic-oracle-v1/validate.mjs';
import {
  adaptCurrentGraphBackup,
  CURRENT_GRAPH_ADAPTER,
} from '../benchmarks/semantic-oracle-v1/adapters/current-graph-backup-v1.mjs';
import { adaptAlternateRecords } from '../benchmarks/semantic-oracle-v1/adapters/alternate-records-v1.mjs';

let primaryTemporary;
const observation = await runCurrentObservation({
  onTemporaryDirectory: (value) => { primaryTemporary = value; },
});
assert.equal(fs.existsSync(primaryTemporary), false,
  'a successful fixture must stop graphd and remove its temporary tree before returning');
const first = adaptCurrentGraphBackup(observation);
assert.equal(CURRENT_GRAPH_ADAPTER.input_format, 'lamina.current-semantic-observation/v1');
const runner = fileURLToPath(new URL('../benchmarks/semantic-oracle-v1/run-current-fixture.mjs', import.meta.url));
const firstChild = execFileSync(process.execPath, [runner], { encoding: 'utf8' });
const secondChild = execFileSync(process.execPath, [runner], { encoding: 'utf8' });
const second = JSON.parse(secondChild);

assert.deepEqual(validateResult(first), { valid: true, errors: [] });
assert.equal(secondChild, firstChild,
  'fresh processes must emit byte-identical normalized JSON for identical inputs');
assert.deepEqual(second, first, 'identical fixture inputs must produce byte-stable normalized semantics');
assert.equal(first.semantic_digest, semanticDigest(first.semantic));

const shuffled = structuredClone(observation);
for (const field of [
  'publication_receipts', 'implementation_obligations', 'cli_receipts', 'derived_observations',
]) shuffled[field].reverse();
for (const field of ['resources', 'aliases', 'statements', 'versions', 'views']) {
  shuffled.graph_backup[field].reverse();
}
{
  const { integrity: _integrity, ...backupBody } = shuffled.graph_backup;
  shuffled.graph_backup.integrity = digest('backup', backupBody);
}
assert.deepEqual(adaptCurrentGraphBackup(shuffled).semantic, first.semantic,
  'native record ordering must not affect normalized semantics');

const tamperedObservation = structuredClone(observation);
tamperedObservation.graph_backup.resources[0].data.adapter_tamper = true;
assert.throws(() => adaptCurrentGraphBackup(tamperedObservation), /invalid integrity/,
  'the adapter must independently verify native backup integrity');

const malformedObservation = structuredClone(observation);
delete malformedObservation.publication_receipts[0].before;
assert.throws(() => adaptCurrentGraphBackup(malformedObservation), /malformed observation/,
  'the versioned native observation schema must reject malformed nested receipts');

function assertMalformedObservation(change, message) {
  const malformed = structuredClone(observation);
  change(malformed);
  assert.throws(
    () => adaptCurrentGraphBackup(malformed),
    (error) => error instanceof Error
      && error.message.startsWith('current graph adapter rejected malformed observation:'),
    message,
  );
}

assertMalformedObservation((value) => {
  value.cli_receipts.find((item) => item.operation === 'work.map').stdout.obligations = null;
}, 'work.map obligation output must be an array at the adapter boundary');
assertMalformedObservation((value) => {
  value.cli_receipts.find((item) => item.operation.startsWith('graph.query.'))
    .stdout.resources = {};
}, 'graph.query resource output must be an array at the adapter boundary');
assertMalformedObservation((value) => {
  value.graph_backup.statements[0].generated_by = {};
  const { integrity: _integrity, ...backupBody } = value.graph_backup;
  value.graph_backup.integrity = digest('backup', backupBody);
}, 'native generator provenance must be an array even with valid backup integrity');
assertMalformedObservation((value) => {
  value.work_started_receipt.work_map.obligations[0].current_evidence = null;
}, 'WorkMap current evidence must be an array at the adapter boundary');
assertMalformedObservation((value) => {
  value.work_started_receipt.work_map.obligations[0].files = null;
}, 'WorkMap file targets must be an array at the adapter boundary');

const unknownOutcome = structuredClone(observation);
const failedRawReceipt = unknownOutcome.publication_receipts.find((item) => item.error);
failedRawReceipt.error.code = 'LAMINA_UNKNOWN_FAILURE';
assert.throws(() => adaptCurrentGraphBackup(unknownOutcome), /unknown publication outcome/,
  'the adapter must not launder unknown native failures as validation failures');

const rawPartial = structuredClone(observation);
const rawFailedPublication = rawPartial.publication_receipts
  .find((item) => item.error?.code === 'LAMINA_VALIDATION_FAILED');
rawFailedPublication.after.visible_resource_ids.push('operation.invalid-partial');
const rawPartialResult = adaptCurrentGraphBackup(rawPartial);
assert.equal(validateResult(rawPartialResult).valid, false,
  'raw failed-publication partial visibility must be rejected after adaptation');

const resourceById = new Map(first.semantic.resources.map((item) => [item.id, item]));
assert.equal(resourceById.has('operation.invalid-partial'), false,
  'a validation failure must not expose staged Resources');
assert.equal(resourceById.has('entity.interrupted-partial'), false,
  'an interruption after internal publication writes must roll back staged Resources');
assert.deepEqual(
  new Set(first.semantic.resources.map((item) => item.epistemic_class)),
  new Set(['intended', 'observed', 'inferred', 'simulated', 'human_evidence', 'runtime_evidence']),
  'the adapter must preserve every current epistemic class',
);

const generated = first.semantic.relations.find((item) => item.predicate === 'lamina:observedAt');
assert.deepEqual(generated.generated_by_ids, ['decision.manual-review'],
  'generator provenance must survive native backup adaptation');

const main = first.semantic.branches.find((item) => item.id === 'branch:main');
const feature = first.semantic.branches.find((item) => item.id === 'branch:feature/semantic-isolation');
assert.ok(main && feature);
assert.equal(main.active_resource_ids.includes('surface.feature-only'), false);
assert.equal(feature.active_resource_ids.includes('surface.feature-only'), true);

const interrupted = first.semantic.publication_attempts
  .find((item) => item.id === 'attempt:interrupted-publication');
assert.equal(interrupted.outcome, 'interrupted');
assert.equal(interrupted.base_version_id, interrupted.head_version_id_after);
assert.equal(interrupted.error_code, 'LAMINA_INJECTED_INTERRUPTION');

const cas = first.semantic.publication_attempts
  .find((item) => item.id === 'attempt:concurrent-b-conflict');
assert.equal(cas.outcome, 'compare_and_swap_failed');
assert.equal(cas.error_code, 'LAMINA_COMPARE_AND_SWAP_FAILED');
assert.ok(main.active_resource_ids.includes('entity.concurrent-a'));
assert.ok(main.active_resource_ids.includes('entity.concurrent-b'));

assert.ok(first.semantic.contradictions.some((item) => item.type === 'statement_conflict'));
const nullLiteral = first.semantic.relations.find((item) => item.predicate === 'custom:nullablePolicy');
const falseLiteral = first.semantic.relations.find((item) => item.predicate === 'custom:enabled');
assert.deepEqual(
  { value_kind: nullLiteral.value_kind, object_id: nullLiteral.object_id, literal: nullLiteral.literal },
  { value_kind: 'literal', object_id: null, literal: null },
  'literal null must remain distinct from a missing object value',
);
assert.deepEqual(
  { value_kind: falseLiteral.value_kind, object_id: falseLiteral.object_id, literal: falseLiteral.literal },
  { value_kind: 'literal', object_id: null, literal: false },
  'falsy literal values must survive normalization',
);

assert.ok(first.semantic.obligations.some((item) => item.category === 'authority'));
assert.ok(first.semantic.obligations.every((item) => item.scope_id === 'workflow.approval'));
assert.ok(first.semantic.obligations.some((item) =>
  item.category === 'operation_contract' && item.details.name === 'Approve request'));
assert.ok(first.semantic.obligations.some((item) =>
  item.resolution_status === 'already_satisfied' && item.complete && item.current_evidence.length));
assert.ok(first.semantic.obligations.some((item) =>
  item.resolution_status === 'change_required' && !item.complete
  && item.files.some((file) => file.role === 'implementation')));

const cliById = new Map(first.semantic.cli_outcomes.map((item) => [item.id, item]));
assert.equal(cliById.get('cli:work-map').result.resolution_statuses[0], 'unresolved');
assert.equal(cliById.get('cli:work-check-unresolved').reason,
  'WorkMap must map every packet obligation exactly once.');
assert.ok(cliById.get('cli:work-check-unresolved').details.invalid_obligation_ids.length > 0);
assert.equal(cliById.get('cli:work-check-accepted').result.schema, 'lamina.work-started/v4');
assert.deepEqual(cliById.get('cli:main-surface-query').result.resource_ids, ['surface.review']);
assert.deepEqual(cliById.get('cli:feature-surface-query').result.resource_ids,
  ['surface.feature-only', 'surface.review']);
assert.equal(cliById.get('cli:invalid-session-publish').reason,
  'Session publication failed validation.');
assert.ok(cliById.get('cli:invalid-session-publish').details.error_messages
  .includes('Workflow workflow.approval has duplicate step position 1.'));
assert.equal(cliById.get('cli:tampered-backup-rejected').reason,
  'Graph backup integrity check failed.');
assert.equal(cliById.get('cli:status-after-tampered-restore').result.graph_version,
  cliById.get('cli:main-status').result.graph_version);

assert.ok(first.semantic.derived_state.every((item) =>
  item.kind === 'semantic_projection'
  && item.rebuildable && !item.authoritative
  && item.rebuild_digest_before === item.rebuild_digest_after
  && item.canonical_head_before === item.canonical_head_after));

const alternateFormatResult = adaptAlternateRecords({
  format: 'example.alternate-semantic-records/v1',
  case_key: first.fixture_id,
  vertices: first.semantic.resources.map((item) => ({
    key: item.id, type: item.kind, truth_class: item.epistemic_class,
    names: item.aliases, properties: item.attributes,
  })),
  arcs: first.semantic.relations.map((item) => ({
    key: item.id, from: item.subject_id, label: item.predicate,
    target: item.value_kind === 'resource'
      ? { tag: 'ref', value: item.object_id }
      : { tag: 'literal', value: item.literal },
    context: item.scope_id, truth_class: item.epistemic_class,
    support: item.evidence_ids, generators: item.generated_by_ids, properties: item.attributes,
  })),
  revisions: first.semantic.graph_versions.map((item) => ({
    key: item.id, source: item.source_revision, ancestors: item.parent_ids,
    resource_delta: { add: item.added_resource_ids, remove: item.retired_resource_ids },
    relation_delta: { add: item.added_relation_ids, remove: item.retired_relation_ids },
    closure: { resources: item.active_resource_ids, relations: item.active_relation_ids },
    gates: {
      structural: item.validation.mechanically_valid,
      ready: item.validation.implementation_ready,
      verified: item.validation.verified,
      approved: item.validation.approved,
      conflicts: item.validation.contradiction_ids,
      gaps: item.validation.readiness_gap_codes,
    },
  })),
  pointers: first.semantic.branches.map((item) => ({
    key: item.id, label: item.name, revision: item.head_version_id, source: item.source_revision,
    closure: { resources: item.active_resource_ids, relations: item.active_relation_ids },
  })),
  conflicts: first.semantic.contradictions.map((item) => ({
    key: item.id, class: item.type, members: item.member_ids,
  })),
  requirements: first.semantic.obligations.map((item) => ({
    key: item.id, class: item.category, context: item.scope_id, subject: item.subject_id,
    required_arcs: item.required_relation_ids, support: item.evidence_ids, contract: item.details,
    resolution: {
      state: item.resolution_status, current: item.current_evidence,
      targets: item.files.map((file) => ({
        file: file.path, change: file.action, purpose: file.role,
      })),
      done: item.complete,
    },
  })),
  transactions: first.semantic.publication_attempts.map((item) => ({
    key: item.id, pointer: item.branch_id, base: item.base_version_id, state: item.outcome,
    result: item.result_version_id, failure: item.error_code,
    observed_head: item.head_version_id_after,
    visible: { resources: item.visible_resource_ids, relations: item.visible_relation_ids },
  })),
  commands: first.semantic.cli_outcomes.map((item) => ({
    key: item.id, name: item.operation, pointer: item.branch,
    status: item.ok ? 'ok' : 'failed', payload: item.result,
    problem: item.ok ? null : { code: item.error_code, reason: item.reason, context: item.details },
  })),
  projections: first.semantic.derived_state.map((item) => ({
    key: item.id, type: item.kind, revision: item.source_version_id, source: item.source_revision,
    disposable: item.rebuildable, authority: item.authoritative ? 'canonical' : 'derived',
    digests: { before: item.rebuild_digest_before, after: item.rebuild_digest_after },
    heads: { before: item.canonical_head_before, after: item.canonical_head_after },
  })),
});
assert.deepEqual(validateResult(alternateFormatResult), { valid: true, errors: [] },
  'alternate field names and tagged value encoding must pass through an explicit adapter');
assert.deepEqual(alternateFormatResult.semantic, first.semantic,
  'field-level alternate records must normalize to identical semantics');

for (const failure of ['setup', 'engine-close']) {
  let temporary;
  await assert.rejects(
    runCurrentFixture({ testFailure: failure, onTemporaryDirectory: (value) => { temporary = value; } }),
    /Injected semantic fixture/,
  );
  assert.equal(fs.existsSync(temporary), false,
    `${failure} failures must still remove the temporary fixture tree`);
}

console.log('semantic oracle contract tests passed');
