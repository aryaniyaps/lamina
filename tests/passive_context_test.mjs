#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupAgent } from '../packages/cli/lib/agent-setup.mjs';
import { contextCatalog } from '../packages/cli/lib/context-index.mjs';
import {
  checkWork,
  deriveWorkMap,
  prepareWork,
  verifyWork,
} from '../packages/cli/lib/work-context.mjs';
import { repositoryContext, runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
import { graphRequest, stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-passive-context-'));
try {
  process.env.LAMINA_TEST_RETRIEVAL_EMBEDDER = 'deterministic';
  process.env.LAMINA_TEST_RETRIEVAL_NO_EXTENSIONS = '1';
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'app.ts'), 'export function saveSchedule() { return "saved"; }\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Existing project rules\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

  const installed = setupAgent({ agent: 'codex' }, root);
  assert.equal(installed.installed, true);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /Existing project rules/);
  const providerRules = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(providerRules, /lamina work prepare/);
  assert.match(providerRules, /Do not invent a workflow name/);
  assert.match(providerRules, /First run `lamina work prepare --request-file <file> --output <packet\.json>`/);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /never foreground `--live`/);
  setupAgent({ agent: 'codex' }, root);
  assert.equal(
    fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').match(/lamina:managed-agent-rules:start/g).length,
    1,
    'provider setup must be idempotent',
  );
  assert.equal(setupAgent({ agent: 'codex', check: true }, root).installed, true);
  setupAgent({ agent: 'cursor' }, root);
  setupAgent({ agent: 'cursor' }, root);
  const cursorRules = fs.readFileSync(path.join(root, '.cursor', 'rules', 'lamina.mdc'), 'utf8');
  assert.equal(cursorRules.match(/alwaysApply: true/g).length, 1);
  assert.equal(cursorRules.match(/lamina:managed-agent-rules:start/g).length, 1);
  setupAgent({ agent: 'cursor', remove: true }, root);
  assert.equal(fs.existsSync(path.join(root, '.cursor', 'rules', 'lamina.mdc')), false);

  const catalog = contextCatalog(root);
  assert.equal(catalog.authority.graph, 'exact_graph_closure');
  assert.equal(catalog.retrieval.dense.fallback, 'fail_closed_for_automatic_workflow_selection');
  assert.equal(catalog.retrieval.dense.authoritative, false);
  assert.equal(catalog.retrieval.fusion.algorithm, 'reciprocal_rank_fusion');

  execFileSync('git', ['add', 'AGENTS.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'provider rules'], { cwd: root });
  const session = await graphRequest('session.start', {}, root);
  const graphResources = [
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
  ];
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
  for (const resource of graphResources) {
    await graphRequest('resource.propose', { session: session.id, resource }, root);
  }
  const graphStatements = [
    { subject: 'workflow.fixture', predicate: 'lamina:hasStep', object: 'operation.fixture', qualifiers: { position: 1 } },
    { subject: 'actor.fixture', predicate: 'lamina:authorizedFor', object: 'operation.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:constrainedBy', object: 'invariant.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:hasScenario', object: 'scenario.fixture' },
    { subject: 'surface.fixture', predicate: 'lamina:realizes', object: 'operation.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:requiresProof', object: 'proof.fixture' },
    { subject: 'persona.fixture', predicate: 'lamina:canAssume', object: 'actor.fixture' },
  ];
  for (const statement of graphStatements) {
    await graphRequest('statement.propose', { session: session.id, statement }, root);
  }
  await graphRequest('session.publish', { id: session.id }, root);

  const walkTask = await graphRequest('design.walk.prepare', {
    workflow: 'workflow.fixture',
    persona: 'persona.fixture',
    request: 'Implement conflict-safe schedule saving in the editor.',
  }, root);
  assert.deepEqual(walkTask.declared_state_kinds['operation.fixture'], ['conflict_review']);
  const recordedWalk = await graphRequest('design.walk.record', {
    task: walkTask,
    result: {
      schema: 'lamina.persona-walk/v1',
      task_id: walkTask.task_id,
      workflow_ref: 'workflow.fixture',
      persona_ref: 'persona.fixture',
      mode: 'subagent',
      isolation_ref: 'test-subagent-schedule-owner',
      goal: journey.goal,
      actor_refs: journey.actor_refs,
      nodes: journey.nodes,
      discoveries: {
        personas: [],
        actors: [],
        operations: [],
        scenarios: [],
        invariants: [],
        surfaces: [],
        branches: [],
        open_decisions: [],
      },
    },
  }, root);
  assert.ok(recordedWalk.persona_walk);

  const requestFile = path.join(os.tmpdir(), `lamina-passive-request-${process.pid}.txt`);
  fs.writeFileSync(requestFile, 'Implement conflict-safe schedule saving in the editor.');
  const packetFile = path.join(os.tmpdir(), `lamina-passive-${process.pid}.packet.json`);
  const packet = await prepareWork({
    requestFile,
    output: packetFile,
  }, root);
  assert.equal(packet.schema, 'lamina.implementation-packet/v5');
  assert.ok(packet.obligations.some((item) => item.type === 'operation_contract'));
  assert.ok(packet.obligations.some((item) => item.type === 'surface'));
  assert.ok(packet.experience_cases.length >= 7);
  assert.ok(packet.experience_cases.some((item) =>
    item.kind === 'surface_state' &&
    item.state === 'conflict_review' &&
    item.surface === 'surface.fixture'),
  'declared operation and Surface states must compile into Persona-bound Experience Cases');
  assert.ok(packet.activated_skills.includes('lamina-forms'));
  assert.equal(packet.retrieval.outcome, 'selected');
  assert.equal(packet.retrieval.freshness, 'fresh');
  assert.equal(packet.retrieval.source_chunks[0].file, 'app.ts');

  const draftMapFile = path.join(os.tmpdir(), `${packet.packet_id}.draft-map.json`);
  const draftMap = deriveWorkMap({ packetFile, output: draftMapFile });
  assert.deepEqual(
    draftMap.obligations.map((item) => item.obligation_id),
    packet.obligations.map((item) => item.obligation_id),
    'WorkMap obligation rows must be mechanically derived from the ImplementationPacket',
  );
  assert.deepEqual(
    draftMap.experience_cases.map((item) => item.case_id),
    packet.experience_cases.map((item) => item.case_id),
    'WorkMap case rows must be mechanically derived from the ImplementationPacket',
  );
  assert.ok([
    ...draftMap.obligations,
    ...draftMap.experience_cases,
  ].every((item) => item.status === 'unresolved'));
  assert.throws(
    () => checkWork({ packetFile, mapFile: draftMapFile }, root),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED',
    'the mechanical scaffold must remain fail-closed until every row is resolved',
  );
  const map = {
    ...draftMap,
    output: undefined,
    obligations: draftMap.obligations.map((item) => ({
      ...item,
      status: 'change_required',
      files: [{ path: 'app.ts', action: 'modify', role: 'implementation' }],
    })),
    experience_cases: draftMap.experience_cases.map((item) => ({
      ...item,
      status: 'change_required',
      files: [{ path: 'app.ts', action: 'modify', role: 'test' }],
    })),
  };
  const mapFile = path.join(os.tmpdir(), `${packet.packet_id}.map.json`);
  const invalidTargetMapFile = path.join(os.tmpdir(), `${packet.packet_id}.missing-target.map.json`);
  fs.writeFileSync(invalidTargetMapFile, JSON.stringify({
    ...map,
    obligations: map.obligations.map((item) => ({
      ...item,
      files: [{ path: 'missing-target.ts', action: 'modify', role: 'implementation' }],
    })),
  }));
  assert.throws(
    () => checkWork({ packetFile, mapFile: invalidTargetMapFile }, root),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.details.invalid_files.some((item) => item.reason === 'missing'),
    'modify mappings must resolve to existing repository files',
  );
  const directoryTargetMapFile = path.join(os.tmpdir(), `${packet.packet_id}.directory-target.map.json`);
  fs.writeFileSync(directoryTargetMapFile, JSON.stringify({
    ...map,
    obligations: map.obligations.map((item) => ({
      ...item,
      files: [{ path: '.', action: 'modify', role: 'implementation' }],
    })),
  }));
  assert.throws(
    () => checkWork({ packetFile, mapFile: directoryTargetMapFile }, root),
    (error) => error.details.invalid_files.some((item) => item.reason === 'not_a_file'),
    'modify mappings must be files rather than directories',
  );
  const existingCreateMapFile = path.join(os.tmpdir(), `${packet.packet_id}.existing-create.map.json`);
  fs.writeFileSync(existingCreateMapFile, JSON.stringify({
    ...map,
    obligations: map.obligations.map((item) => ({
      ...item,
      files: [{ path: 'app.ts', action: 'create', role: 'implementation' }],
    })),
  }));
  assert.throws(
    () => checkWork({ packetFile, mapFile: existingCreateMapFile }, root),
    (error) => error.details.invalid_files.some((item) =>
      item.reason === 'already_exists_use_modify'),
    'existing files must declare action=modify',
  );
  const gitTargetMapFile = path.join(os.tmpdir(), `${packet.packet_id}.git-target.map.json`);
  fs.writeFileSync(gitTargetMapFile, JSON.stringify({
    ...map,
    obligations: map.obligations.map((item) => ({
      ...item,
      files: [{ path: '.git/config', action: 'modify', role: 'implementation' }],
    })),
  }));
  assert.throws(
    () => checkWork({ packetFile, mapFile: gitTargetMapFile }, root),
    (error) => error.details.invalid_files.some((item) =>
      item.reason === 'invalid_file_mapping'),
    'WorkMap files must never resolve through repository metadata',
  );
  const outsideTarget = path.join(os.tmpdir(), `${packet.packet_id}.outside.ts`);
  const outsideLink = path.join(root, 'outside-link.ts');
  fs.writeFileSync(outsideTarget, 'export const outside = true;\n');
  fs.symlinkSync(outsideTarget, outsideLink);
  const outsideLinkMapFile = path.join(os.tmpdir(), `${packet.packet_id}.outside-link.map.json`);
  fs.writeFileSync(outsideLinkMapFile, JSON.stringify({
    ...map,
    obligations: map.obligations.map((item) => ({
      ...item,
      files: [{ path: 'outside-link.ts', action: 'modify', role: 'implementation' }],
    })),
  }));
  assert.throws(
    () => checkWork({ packetFile, mapFile: outsideLinkMapFile }, root),
    (error) => error.details.invalid_files.some((item) =>
      item.reason === 'outside_repository'),
    'WorkMap files must not escape the repository through symlinks',
  );
  fs.unlinkSync(outsideLink);
  fs.unlinkSync(outsideTarget);
  const createsOnlyMapFile = path.join(os.tmpdir(), `${packet.packet_id}.creates-only.map.json`);
  fs.writeFileSync(createsOnlyMapFile, JSON.stringify({
    ...map,
    obligations: map.obligations.map((item) => ({
      ...item,
      files: [{
        path: 'src/new-feature/page.tsx',
        action: 'create',
        role: 'implementation',
      }],
    })),
    experience_cases: map.experience_cases.map((item) => ({
      ...item,
      files: [{
        path: 'src/new-feature/page.test.tsx',
        action: 'create',
        role: 'test',
      }],
    })),
  }));
  assert.equal(
    checkWork({ packetFile, mapFile: createsOnlyMapFile }, root).schema,
    'lamina.work-started/v4',
    'brand-new features must pass the pre-edit gate with planned creates whose parent exists',
  );
  fs.mkdirSync(path.join(root, 'src', 'new-feature'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'new-feature', 'page.tsx'), 'export default function Page() { return null; }\n');
  fs.writeFileSync(path.join(root, 'src', 'new-feature', 'page.test.tsx'), 'export const tested = true;\n');
  await assert.rejects(
    () => verifyWork({ packetFile, mapFile: createsOnlyMapFile }, root),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.message.includes('graph is stale'),
    'verify must accept a realized creates path before continuing to source reconciliation',
  );
  fs.rmSync(path.join(root, 'src'), { recursive: true, force: true });
  fs.writeFileSync(mapFile, JSON.stringify(map));
  const started = checkWork({ packetFile, mapFile }, root);
  assert.equal(started.schema, 'lamina.work-started/v4');
  assert.ok(fs.existsSync(started.receipt));
  const mutatedMap = {
    ...map,
    obligations: map.obligations.map((item, index) => index === 0
      ? {
          ...item,
          files: [{ path: 'different.ts', action: 'create', role: 'implementation' }],
        }
      : item),
  };
  fs.writeFileSync(mapFile, JSON.stringify(mutatedMap));
  await assert.rejects(
    () => verifyWork({ packetFile, mapFile }, root),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.message.includes('WorkMap changed after WorkStarted'),
    'verification must reject any mutation of the checked requirement-to-file map',
  );
  fs.writeFileSync(mapFile, JSON.stringify(map));
  await assert.rejects(
    () => verifyWork({ packetFile, mapFile }, root),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.message.includes('Published live Mission evidence is incomplete'),
    'a checked WorkMap without published Mission runs must never count as verification',
  );

  const artifacts = Object.fromEntries(
    ['functional', 'visual', 'responsive', 'accessibility'].map((kind) => {
      const file = path.join(os.tmpdir(), `${packet.packet_id}.${kind}.evidence.txt`);
      fs.writeFileSync(file, `observed ${kind} evidence`);
      return [kind, file];
    }),
  );
  const experienceArtifact = path.join(os.tmpdir(), `${packet.packet_id}.experience.txt`);
  fs.writeFileSync(experienceArtifact, 'Observed case behavior matched the compiled expectation.\n');
  const compiled = await graphRequest('mission.compile', { workflow: 'workflow.fixture' }, root);
  assert.equal(compiled.missions.length, 1);
  await assert.rejects(
    () => graphRequest('mission.run', {
      mission: compiled.missions[0].id,
      events: [{ type: 'oracle_passed' }],
    }, root),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.message.includes('expected case_id'),
    'a generic pass event must not verify any compiled Experience Case',
  );
  await assert.rejects(
    () => graphRequest('mission.run', {
      mission: compiled.missions[0].id,
      events: [{
        type: 'audit_passed',
        audit_kind: 'visual',
        surface: 'surface.fixture',
        state: 'invented',
        artifact: artifacts.visual,
      }],
    }, root),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.message.includes('concrete state'),
    'a UI audit must be scoped to a state compiled from the Persona walk',
  );
  const missionRun = await graphRequest('mission.run', {
    mission: compiled.missions[0].id,
    events: [
      ...compiled.missions[0].experience_cases.map((item) => ({
        type: 'oracle_passed',
        case_id: item.case_id,
        observation: { expected: item.expected || item, observed: 'matched' },
        artifact: experienceArtifact,
      })),
      ...Object.entries(artifacts).map(([audit_kind, artifact]) => ({
        type: 'audit_passed',
        audit_kind,
        surface: 'surface.fixture',
        state: 'entry',
        artifact,
      })),
    ],
  }, root);
  await assert.rejects(
    () => verifyWork({ packetFile, mapFile }, root),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.message.includes('Published live Mission evidence is incomplete'),
    'staged HarnessResults must not satisfy WorkVerified',
  );
  await graphRequest('session.publish', { id: missionRun.session }, root);
  const verified = await verifyWork({ packetFile, mapFile }, root);
  assert.equal(verified.verified, true);
  assert.equal(verified.mission_evidence.length, 1);
  assert.equal(verified.mission_evidence[0].harness_result, missionRun.harness_result);
  assert.equal(verified.work_started_receipt_id, started.receipt_id);
  assert.equal(verified.work_map, undefined);
  assert.match(verified.work_map_digest, /^work_map_/);

  const expandedDesign = await graphRequest('session.start', {}, root);
  await graphRequest('resource.propose', {
    session: expandedDesign.id,
    resource: {
      id: 'scenario.fixture.offline',
      kind: 'scenario',
      data: { name: 'connectivity is lost during save' },
    },
  }, root);
  await graphRequest('statement.propose', {
    session: expandedDesign.id,
    statement: {
      subject: 'workflow.fixture',
      predicate: 'lamina:hasScenario',
      object: 'scenario.fixture.offline',
    },
  }, root);
  await graphRequest('session.publish', { id: expandedDesign.id }, root);
  const expandedContext = await graphRequest('work.context', {
    workflows: ['workflow.fixture'],
    request: 'Extend schedule saving.',
  }, root);
  assert.equal(expandedContext.implementation_ready, false);
  assert.ok(
    expandedContext.readiness_gaps.some((gap) =>
      gap.code === 'persona_walk_missing'),
    'expanding the Workflow coverage must invalidate prior Persona walks until every affected walk reruns',
  );

  const incompleteDesign = await graphRequest('session.start', {}, root);
  for (const resource of [
    { id: 'workflow.missing-experience', kind: 'workflow', data: { name: 'missing persona walk' } },
    { id: 'operation.missing-experience', kind: 'operation', data: { name: 'submit request' } },
    { id: 'surface.missing-experience', kind: 'surface', data: { name: 'request form' } },
  ]) await graphRequest('resource.propose', { session: incompleteDesign.id, resource }, root);
  for (const statement of [
    {
      subject: 'workflow.missing-experience',
      predicate: 'lamina:hasStep',
      object: 'operation.missing-experience',
      qualifiers: { position: 1 },
    },
    {
      subject: 'surface.missing-experience',
      predicate: 'lamina:realizes',
      object: 'operation.missing-experience',
    },
  ]) await graphRequest('statement.propose', { session: incompleteDesign.id, statement }, root);
  await graphRequest('session.publish', { id: incompleteDesign.id }, root);
  const blockedContext = await graphRequest('work.context', {
    workflows: ['workflow.missing-experience'],
    request: 'Implement the request form.',
  }, root);
  assert.equal(blockedContext.implementation_ready, false);
  assert.ok(
    blockedContext.readiness_gaps.some((gap) => gap.code === 'persona_walk_missing'),
    'a Workflow without current Persona walks must fail closed before source edits',
  );

  const incomplete = { ...map, obligations: [] };
  fs.writeFileSync(mapFile, JSON.stringify(incomplete));
  assert.throws(
    () => checkWork({ packetFile, mapFile }, root),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.details.missing.length === packet.obligations.length,
  );
  await stopIncompatibleServer(runtimePaths(root));
  fs.unlinkSync(requestFile);
  for (const artifact of Object.values(artifacts)) fs.unlinkSync(artifact);
  fs.unlinkSync(experienceArtifact);
  fs.unlinkSync(packetFile);
  fs.unlinkSync(mapFile);
  fs.unlinkSync(invalidTargetMapFile);
  fs.unlinkSync(directoryTargetMapFile);
  fs.unlinkSync(existingCreateMapFile);
  fs.unlinkSync(gitTargetMapFile);
  fs.unlinkSync(outsideLinkMapFile);
  fs.unlinkSync(createsOnlyMapFile);

  setupAgent({ agent: 'codex', remove: true }, root);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /lamina:managed-agent-rules:start/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('passive_context_test: ok');
