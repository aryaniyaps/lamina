#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupAgent } from '../packages/cli/lib/agent-setup.mjs';
import { contextCatalog, sourceCandidates } from '../packages/cli/lib/context-index.mjs';
import { checkWork, prepareWork, verifyWork } from '../packages/cli/lib/work-context.mjs';
import { repositoryContext, runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
import { graphRequest, stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-passive-context-'));
try {
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
  assert.equal(catalog.retrieval.dense.fallback, 'lexical_degraded');
  assert.equal(catalog.retrieval.dense.authoritative, false);
  assert.equal(sourceCandidates('save schedule', root)[0].path, 'app.ts');

  execFileSync('git', ['add', 'AGENTS.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'provider rules'], { cwd: root });
  const session = await graphRequest('session.start', {}, root);
  for (const resource of [
    { id: 'workflow.fixture', kind: 'workflow', data: { name: 'save schedule' } },
    { id: 'operation.fixture', kind: 'operation', data: { name: 'save schedule', description: 'Persist a valid schedule.' } },
    { id: 'actor.fixture', kind: 'actor', data: { name: 'member' } },
    { id: 'persona.fixture', kind: 'persona', data: { name: 'schedule owner' } },
    { id: 'invariant.fixture', kind: 'invariant', data: { name: 'valid schedule' } },
    { id: 'scenario.fixture', kind: 'scenario', data: { name: 'conflicting edit' } },
    { id: 'surface.fixture', kind: 'surface', data: { name: 'schedule editor' } },
    { id: 'proof.fixture', kind: 'proof', data: { name: 'schedule UI proof' } },
    {
      id: 'decision.fixture-experience',
      kind: 'decision',
      data: {
        schema: 'lamina.experience-contract/v1',
        workflow_ref: 'workflow.fixture',
        name: 'Schedule editor experience contract',
        operations: [{
          operation_ref: 'operation.fixture',
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
          success: { visible_state: 'The saved schedule is visible after durable confirmation.' },
          failures: [{
            code: 'SCHEDULE_CONFLICT',
            scenario_ref: 'scenario.fixture',
            visible_message: 'The schedule changed. Review the latest value.',
            recovery: 'Preserve the proposed value and allow review and retry.',
            preserves_input: true,
          }],
        }],
        surfaces: [{
          surface_ref: 'surface.fixture',
          states: [
            { id: 'ready', visible_state: 'The current schedule is editable.' },
            { id: 'success', visible_state: 'The durable saved schedule is shown.' },
            { id: 'error', visible_state: 'The conflict and recovery action are shown.' },
          ],
          fields: [{
            input_ref: 'operation.fixture:schedule',
            label: 'Schedule',
            required: true,
            error_target: 'schedule-error',
          }],
          failure_presentations: [{
            scenario_ref: 'scenario.fixture',
            message: 'The schedule changed. Review the latest value.',
            recovery: 'Review and retry without losing the proposed value.',
          }],
        }],
        invariant_cases: [{
          invariant_ref: 'invariant.fixture',
          surface_ref: 'surface.fixture',
          attempt: 'Submit an invalid or stale schedule.',
          expected: 'The invalid state is rejected and the entered schedule remains editable.',
        }],
      },
    },
  ]) await graphRequest('resource.propose', { session: session.id, resource }, root);
  for (const statement of [
    { subject: 'workflow.fixture', predicate: 'lamina:hasStep', object: 'operation.fixture', qualifiers: { position: 1 } },
    { subject: 'actor.fixture', predicate: 'lamina:authorizedFor', object: 'operation.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:constrainedBy', object: 'invariant.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:hasScenario', object: 'scenario.fixture' },
    { subject: 'surface.fixture', predicate: 'lamina:realizes', object: 'operation.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:requiresProof', object: 'proof.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:experienceContract', object: 'decision.fixture-experience' },
    { subject: 'persona.fixture', predicate: 'lamina:relevantTo', object: 'workflow.fixture' },
  ]) await graphRequest('statement.propose', { session: session.id, statement }, root);
  await graphRequest('session.publish', { id: session.id }, root);

  const requestFile = path.join(os.tmpdir(), `lamina-passive-request-${process.pid}.txt`);
  fs.writeFileSync(requestFile, 'Implement conflict-safe schedule saving in the editor.');
  const packetFile = path.join(os.tmpdir(), `lamina-passive-${process.pid}.packet.json`);
  const packet = await prepareWork({
    requestFile,
    output: packetFile,
  }, root);
  assert.equal(packet.schema, 'lamina.implementation-packet/v2');
  assert.ok(packet.obligations.some((item) => item.type === 'operation_contract'));
  assert.ok(packet.obligations.some((item) => item.type === 'surface'));
  assert.ok(packet.experience_cases.length >= 7);
  assert.ok(packet.activated_skills.includes('lamina-forms'));
  assert.equal(packet.source_retrieval.catalog.authority.graph, 'exact_graph_closure');

  const map = {
    schema: 'lamina.work-map/v2',
    packet_id: packet.packet_id,
    obligations: packet.obligations.map((item) => ({
      obligation_id: item.obligation_id,
      status: 'change_required',
      current_evidence: [],
      targets: ['app.ts'],
      verification: [{ kind: 'functional', status: 'planned' }],
    })),
    experience_cases: packet.experience_cases.map((item) => ({
      case_id: item.case_id,
      status: 'change_required',
      targets: ['app.ts'],
      fixture: `fixture for ${item.case_id}`,
      steps: ['Open the schedule editor.', 'Exercise the exact case.'],
      expected: JSON.stringify(item.expected || item),
      verification: [{ kind: 'functional', status: 'planned' }],
    })),
  };
  const mapFile = path.join(os.tmpdir(), `${packet.packet_id}.map.json`);
  fs.writeFileSync(mapFile, JSON.stringify(map));
  const started = checkWork({ packetFile, mapFile }, root);
  assert.equal(started.schema, 'lamina.work-started/v2');
  assert.ok(fs.existsSync(started.receipt));
  await assert.rejects(
    () => verifyWork({ packetFile, mapFile }, root),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.message.includes('evidence is incomplete'),
    'planned checks and absent artifacts must never count as verification',
  );

  const artifacts = Object.fromEntries(
    ['functional', 'visual', 'responsive', 'accessibility'].map((kind) => {
      const file = path.join(os.tmpdir(), `${packet.packet_id}.${kind}.evidence.txt`);
      fs.writeFileSync(file, `observed ${kind} evidence`);
      return [kind, file];
    }),
  );
  const experienceArtifact = path.join(os.tmpdir(), `${packet.packet_id}.experience.json`);
  fs.writeFileSync(experienceArtifact, JSON.stringify({
    schema: 'lamina.experience-evidence/v1',
    case_ids: packet.experience_cases.map((item) => item.case_id),
    passed: true,
    steps: ['Opened the editor', 'Exercised the case', 'Observed the expected result'],
    expected: 'The case-specific expected result',
    observed: 'The case-specific expected result was visible in the live product',
  }));
  const verifiedMap = {
    ...map,
    obligations: map.obligations.map((item) => {
      const obligation = packet.obligations.find((candidate) =>
        candidate.obligation_id === item.obligation_id);
      const kinds = ['surface', 'surface_realization'].includes(obligation.type)
        ? ['functional', 'visual', 'responsive', 'accessibility']
        : ['functional'];
      return {
        ...item,
        verification: kinds.map((kind) => ({ kind, status: 'passed', artifact: artifacts[kind] })),
      };
    }),
    experience_cases: map.experience_cases.map((item) => ({
      ...item,
      verification: [{ kind: 'functional', status: 'passed', artifact: experienceArtifact }],
    })),
  };
  fs.writeFileSync(mapFile, JSON.stringify(verifiedMap));
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
    'a UI audit must be scoped to a state declared by the Experience Contract',
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
        state: 'ready',
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
  assert.equal(verified.work_map.packet_id, packet.packet_id);
  assert.match(verified.work_map_digest, /^work_map_/);

  const incompleteDesign = await graphRequest('session.start', {}, root);
  for (const resource of [
    { id: 'workflow.missing-experience', kind: 'workflow', data: { name: 'missing experience contract' } },
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
    blockedContext.readiness_gaps.some((gap) => gap.code === 'experience_contract_missing'),
    'a surface workflow without an Experience Contract must fail closed before source edits',
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

  setupAgent({ agent: 'codex', remove: true }, root);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /lamina:managed-agent-rules:start/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('passive_context_test: ok');
