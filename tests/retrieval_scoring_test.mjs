#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitByteCompare } from '../packages/cli/lib/source-inventory.mjs';
import {
  bm25Ranking,
  classifyWorkflowOutcome,
  fuseRankings,
  hybridRanking,
} from '../packages/cli/lib/retrieval-runtime/scoring.mjs';
import { prepareWork } from '../packages/cli/lib/work-context.mjs';
import { graphRequest, stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
import { runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
import { removeTemporaryTree } from './test-util.mjs';

function vector(index) {
  return Array.from({ length: 768 }, (_, item) => item === index ? 1 : 0);
}

function blendedVector(...indices) {
  const weight = 1 / Math.sqrt(indices.length);
  return Array.from({ length: 768 }, (_, item) => indices.includes(item) ? weight : 0);
}

function document(id, text, embedding, aliases = [id]) {
  return {
    id: `doc-${id}`,
    logical_key: `workflow:${id}`,
    workflow_id: id,
    aliases,
    text,
    embedding,
    metadata: { facets: { operations: text.split(/\s+/) } },
  };
}

const documents = [
  document('workflow.billing', 'billing invoice payment reconciliation', vector(0), ['billing']),
  document('workflow.notifications', 'notifications delivery reminder preferences', vector(1), ['notify']),
  document('workflow.profile', 'member profile settings preferences', vector(2), ['profile']),
];

const ranking = hybridRanking(documents, 'billing invoice', vector(0));
const rankingRepeat = hybridRanking(documents, 'billing invoice', vector(0));
assert.deepEqual(
  ranking.map((row) => [row.document.workflow_id, row.score]),
  rankingRepeat.map((row) => [row.document.workflow_id, row.score]),
  'hybrid ranking must be deterministic across repeated runs',
);

const tiedDocs = [
  document('workflow.alpha', 'billing payment shared', vector(0)),
  document('workflow.beta', 'billing payment shared', vector(0)),
];
const tiedRanking = fuseRankings(tiedDocs, 'billing payment', [], []);
assert.equal(tiedRanking.length, 2);
assert.equal(tiedRanking[0].score, tiedRanking[1].score);
assert.ok(
  gitByteCompare(tiedRanking[0].document.id, tiedRanking[1].document.id) <= 0,
  'equal fused scores must tie-break by document id bytes',
);

const lexicalOnly = fuseRankings(
  documents,
  'billing',
  bm25Ranking(documents, 'billing'),
  [],
);
assert.ok(lexicalOnly[0].document.workflow_id === 'workflow.billing');
assert.equal(lexicalOnly[0].dense_score, 0);

assert.deepEqual(classifyWorkflowOutcome('billing', ranking).selected, ['workflow.billing']);
assert.equal(classifyWorkflowOutcome('billing and notifications', hybridRanking(
  documents,
  'billing and notifications',
  blendedVector(0, 1),
)).outcome, 'multi_workflow');
assert.equal(classifyWorkflowOutcome('preferences', hybridRanking(
  documents,
  'preferences',
  blendedVector(1, 2),
)).outcome, 'ambiguous');
assert.equal(classifyWorkflowOutcome('astronomy telescope', hybridRanking(
  documents,
  'astronomy telescope',
  vector(7),
)).outcome, 'new_workflow_required');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-retrieval-scoring-prepare-'));
try {
  process.env.LAMINA_TEST_RETRIEVAL_EMBEDDER = 'deterministic';
  process.env.LAMINA_TEST_RETRIEVAL_NO_EXTENSIONS = '1';
  const corruptModel = path.join(root, 'corrupt-model.onnx');
  fs.writeFileSync(corruptModel, 'corrupt');
  process.env.LAMINA_RETRIEVAL_MODEL_PATH = corruptModel;
  delete process.env.LAMINA_TEST_RETRIEVAL_EMBEDDER;

  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'app.ts'), 'export function saveSchedule() { return "saved"; }\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

  const session = await graphRequest('session.start', {}, root);
  for (const resource of [
    { id: 'workflow.fixture', kind: 'workflow', data: { name: 'save schedule' } },
    { id: 'operation.fixture', kind: 'operation', data: { name: 'save schedule', description: 'Persist a valid schedule.' } },
    { id: 'actor.fixture', kind: 'actor', data: { name: 'member' } },
    { id: 'persona.fixture', kind: 'persona', data: { name: 'schedule owner' } },
    { id: 'invariant.fixture', kind: 'invariant', data: { name: 'valid schedule' } },
    { id: 'scenario.fixture', kind: 'scenario', data: { name: 'conflicting edit' } },
    {
      id: 'surface.fixture',
      kind: 'surface',
      data: { name: 'schedule editor', states: ['conflict_review'] },
    },
    { id: 'proof.fixture', kind: 'proof', data: { name: 'schedule UI proof' } },
  ]) {
    await graphRequest('resource.propose', { session: session.id, resource }, root);
  }
  for (const statement of [
    { subject: 'workflow.fixture', predicate: 'lamina:hasStep', object: 'operation.fixture', qualifiers: { position: 1 } },
    { subject: 'actor.fixture', predicate: 'lamina:authorizedFor', object: 'operation.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:constrainedBy', object: 'invariant.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:hasScenario', object: 'scenario.fixture' },
    { subject: 'surface.fixture', predicate: 'lamina:realizes', object: 'operation.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:requiresProof', object: 'proof.fixture' },
    { subject: 'persona.fixture', predicate: 'lamina:canAssume', object: 'actor.fixture' },
  ]) {
    await graphRequest('statement.propose', { session: session.id, statement }, root);
  }
  await graphRequest('session.publish', { id: session.id }, root);

  const journey = {
    persona_ref: 'persona.fixture',
    actor_refs: ['actor.fixture'],
    goal: 'Save a schedule without losing a concurrent edit.',
    nodes: [{
      id: 'node.fixture.save-schedule',
      operation_ref: 'operation.fixture',
      intent: 'Persist the proposed schedule and understand whether it was accepted.',
      permission: {
        decision: 'allowed',
        actor_ref: 'actor.fixture',
        rationale: 'The schedule owner is authorized to edit their schedule.',
      },
      inputs: [{
        id: 'schedule',
        source: 'actor',
        required: true,
        rationale: 'A schedule is the value being saved.',
        normalization: 'preserve local wall time',
      }],
      relationship_policy: {
        mode: 'none',
        rationale: 'Saving a schedule does not create an actor or ownership relationship.',
      },
      surface_refs: ['surface.fixture'],
      state_coverage: [
        { kind: 'entry', applicable: true, visible_state: 'The current schedule is editable.' },
        { kind: 'in_progress', applicable: true, visible_state: 'Saving is visibly in progress.' },
        { kind: 'empty', applicable: false, rationale: 'A saved schedule always has an editable value.' },
        { kind: 'success', applicable: true, visible_state: 'The durable saved schedule is shown.' },
        { kind: 'failure', applicable: true, visible_state: 'The conflict and recovery action are shown.' },
        { kind: 'denied', applicable: false, rationale: 'This Persona is authorized at this node.' },
        { kind: 'recovery', applicable: true, visible_state: 'The proposed value remains available for review and retry.' },
        { kind: 'conflict_review', applicable: true, visible_state: 'The latest and proposed schedules are shown for comparison.' },
      ],
      scenario_coverage: [{
        scenario_ref: 'scenario.fixture',
        applicable: true,
        trigger: 'Another accepted edit changes the schedule before this save completes.',
        expected: 'The stale save is rejected with the latest value identified.',
        recovery: 'Preserve the proposed value and allow review and retry.',
        preserves_input: true,
      }],
      edge_case_coverage: [
        { kind: 'validation', applicable: true, trigger: 'The schedule is invalid.', expected: 'The invalid value is rejected visibly.', recovery: 'Correct the value without losing it.' },
        { kind: 'authorization', applicable: false, rationale: 'Authorization is covered by a separate denied Persona journey when relevant.' },
        { kind: 'duplicate', applicable: false, rationale: 'The operation replaces one identified schedule rather than creating duplicates.' },
        { kind: 'self_reference', applicable: false, rationale: 'The operation creates no relationship.' },
        { kind: 'concurrency', applicable: true, trigger: 'Two saves race.', expected: 'No accepted save is silently overwritten.', recovery: 'Review the latest value and retry.' },
        { kind: 'stale_data', applicable: true, trigger: 'The editor submits an old revision.', expected: 'The stale revision is rejected.', recovery: 'Merge or retry from the latest revision.' },
        { kind: 'interruption', applicable: true, trigger: 'The client closes during save.', expected: 'The next load shows only confirmed state.', recovery: 'Retry if no durable save is visible.' },
        { kind: 'retry', applicable: true, trigger: 'The actor retries after an uncertain result.', expected: 'The retry is idempotent.', recovery: 'Show the authoritative saved state.' },
        { kind: 'connectivity', applicable: true, trigger: 'Connectivity fails during save.', expected: 'No unconfirmed success is shown.', recovery: 'Preserve input and retry when connected.' },
      ],
      invariant_probes: [{
        invariant_ref: 'invariant.fixture',
        applicable: true,
        attempt: 'Submit an invalid or stale schedule.',
        expected: 'The invalid state is rejected and the entered schedule remains editable.',
      }],
      transitions: [
        { outcome: 'success', terminal: true, expected: 'The confirmed schedule is visible.' },
        { outcome: 'scenario:scenario.fixture', terminal: true, expected: 'The conflict recovery state is visible.' },
      ],
    }],
  };
  const walkTask = await graphRequest('design.walk.prepare', {
    workflow: 'workflow.fixture',
    persona: 'persona.fixture',
    request: 'Implement conflict-safe schedule saving in the editor.',
  }, root);
  await graphRequest('design.walk.record', {
    task: walkTask,
    result: {
      schema: 'lamina.persona-walk/v1',
      task_id: walkTask.task_id,
      workflow_ref: 'workflow.fixture',
      persona_ref: 'persona.fixture',
      mode: 'subagent',
      isolation_ref: 'test-scoring-degraded',
      goal: journey.goal,
      actor_refs: journey.actor_refs,
      nodes: journey.nodes,
      discoveries: {
        personas: [], actors: [], operations: [], scenarios: [], invariants: [],
        surfaces: [], branches: [], open_decisions: [],
      },
    },
  }, root);

  const requestFile = path.join(os.tmpdir(), `lamina-scoring-request-${process.pid}.txt`);
  fs.writeFileSync(requestFile, 'Implement conflict-safe schedule saving in the editor.');
  const packetFile = path.join(os.tmpdir(), `lamina-scoring-${process.pid}.packet.json`);

  await assert.rejects(
    () => prepareWork({ requestFile, output: packetFile }, root),
    (error) => error.code === 'LAMINA_RETRIEVAL_INTEGRITY',
    'automatic workflow selection must fail closed when dense retrieval is unavailable',
  );

  const packet = await prepareWork({
    requestFile,
    workflows: ['workflow.fixture'],
    output: packetFile,
  }, root);
  assert.equal(packet.schema, 'lamina.implementation-packet/v5');
  assert.equal(packet.retrieval.degradation, 'lexical_degraded');
  assert.equal(packet.retrieval.explicit_workflow_bypass, true);
  assert.equal(packet.retrieval.outcome, 'selected');
  assert.deepEqual(packet.retrieval.selected_workflow_ids, ['workflow.fixture']);
  assert.ok(packet.obligations.some((item) => item.type === 'operation_contract'),
    'explicit --workflow must still compile exact graph closure');
  assert.ok(packet.retrieval.source_chunks.some((item) => item.file === 'app.ts'),
    'lexical_degraded must still localize source chunks');

  fs.unlinkSync(requestFile);
  fs.unlinkSync(packetFile);
  await stopIncompatibleServer(runtimePaths(root));
} finally {
  delete process.env.LAMINA_RETRIEVAL_MODEL_PATH;
  delete process.env.LAMINA_TEST_RETRIEVAL_EMBEDDER;
  delete process.env.LAMINA_TEST_RETRIEVAL_NO_EXTENSIONS;
  removeTemporaryTree(root);
}

console.log('retrieval_scoring_test: ok');
