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
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /lamina work prepare/);
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
    { id: 'invariant.fixture', kind: 'invariant', data: { name: 'valid schedule' } },
    { id: 'scenario.fixture', kind: 'scenario', data: { name: 'conflicting edit' } },
    { id: 'surface.fixture', kind: 'surface', data: { name: 'schedule editor' } },
    { id: 'proof.fixture', kind: 'proof', data: { name: 'schedule UI proof' } },
  ]) await graphRequest('resource.propose', { session: session.id, resource }, root);
  for (const statement of [
    { subject: 'workflow.fixture', predicate: 'lamina:hasStep', object: 'operation.fixture', qualifiers: { position: 1 } },
    { subject: 'actor.fixture', predicate: 'lamina:authorizedFor', object: 'operation.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:constrainedBy', object: 'invariant.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:hasScenario', object: 'scenario.fixture' },
    { subject: 'surface.fixture', predicate: 'lamina:realizes', object: 'operation.fixture' },
    { subject: 'workflow.fixture', predicate: 'lamina:requiresProof', object: 'proof.fixture' },
  ]) await graphRequest('statement.propose', { session: session.id, statement }, root);
  await graphRequest('session.publish', { id: session.id }, root);

  const requestFile = path.join(os.tmpdir(), `lamina-passive-request-${process.pid}.txt`);
  fs.writeFileSync(requestFile, 'Implement conflict-safe schedule saving in the editor.');
  const packetFile = path.join(os.tmpdir(), `lamina-passive-${process.pid}.packet.json`);
  const packet = await prepareWork({
    requestFile,
    workflows: ['workflow.fixture'],
    output: packetFile,
  }, root);
  assert.equal(packet.schema, 'lamina.implementation-packet/v1');
  assert.ok(packet.obligations.some((item) => item.type === 'operation_contract'));
  assert.ok(packet.obligations.some((item) => item.type === 'surface'));
  assert.equal(packet.source_retrieval.catalog.authority.graph, 'exact_graph_closure');

  const map = {
    schema: 'lamina.work-map/v1',
    packet_id: packet.packet_id,
    obligations: packet.obligations.map((item) => ({
      obligation_id: item.obligation_id,
      status: 'change_required',
      current_evidence: [],
      targets: ['app.ts'],
      verification: [{ kind: 'functional', status: 'planned' }],
    })),
  };
  const mapFile = path.join(os.tmpdir(), `${packet.packet_id}.map.json`);
  fs.writeFileSync(mapFile, JSON.stringify(map));
  const started = checkWork({ packetFile, mapFile }, root);
  assert.equal(started.schema, 'lamina.work-started/v1');
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
  };
  fs.writeFileSync(mapFile, JSON.stringify(verifiedMap));
  const verified = await verifyWork({ packetFile, mapFile }, root);
  assert.equal(verified.verified, true);

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
  fs.unlinkSync(packetFile);
  fs.unlinkSync(mapFile);

  setupAgent({ agent: 'codex', remove: true }, root);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /lamina:managed-agent-rules:start/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('passive_context_test: ok');
