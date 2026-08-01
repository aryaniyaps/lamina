#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  ensureAuthToken,
  graphSocketPath,
  runtimePaths,
} from '../packages/cli/lib/graph-runtime/util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-graphd-protocol-'));
execFileSync('git', ['init', '-b', 'main'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
fs.writeFileSync(path.join(root, 'README.md'), '# Protocol fixture\n');
execFileSync('git', ['add', 'README.md'], { cwd: root });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

const paths = runtimePaths(root);
const endpoint = graphSocketPath(paths);
const serverPath = path.resolve('packages/cli/lib/graph-runtime/server.mjs');
const server = spawn(process.execPath, [serverPath, root], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
server.stderr.on('data', (chunk) => { stderr += chunk; });
const auth = ensureAuthToken(paths);
fs.writeFileSync(paths.lock, `${JSON.stringify({
  pid: 2_147_483_647,
  protocol_version: 2,
})}\n`);

function request(method, params = {}, token = auth) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({
      id: `${method}-${Date.now()}`,
      method,
      params,
      cwd: root,
      auth: token,
    })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
    socket.on('error', reject);
  });
}

try {
  const deadline = Date.now() + 10_000;
  let ping = null;
  while (!ping) {
    if (server.exitCode !== null) throw new Error(`graphd exited early: ${stderr}`);
    if (Date.now() > deadline) throw new Error(`graphd did not listen at ${endpoint}`);
    try { ping = await request('ping'); } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  assert.equal(ping.result.protocol_version, 9);
  assert.ok(ping.result.capabilities.includes('work.context.v5'));
  assert.ok(ping.result.capabilities.includes('retrieval.hybrid.v1'));
  assert.equal(ping.result.runtime_version, '0.3.5');
  assert.deepEqual(ping.result.capabilities, [
    'observation.status.source_key_count',
    'observation.status.generation',
    'retrieval.hybrid.v1',
    'work.context.v5',
    'design.persona-walk.v1',
    'work.persona-case-map.v4',
    'mission.persona-case-evidence.v4',
  ]);
  assert.equal(ping.result.auth, undefined, 'authentication token must never be returned');

  const unauthenticated = await request('ping', {}, '');
  assert.equal(unauthenticated.ok, false);
  assert.equal(unauthenticated.error.code, 'LAMINA_UNAUTHORIZED');

  const session = await request('session.start');
  assert.equal(session.ok, true);
  const staged = await request('resource.propose', {
    session: session.result.id,
    resource: { id: 'product.protocol', kind: 'product', data: { name: 'Protocol' } },
  });
  assert.equal(staged.ok, true);
  assert.equal((await request('session.publish', { id: session.result.id })).ok, true);

  const query = await request('graph.query', { at: 'HEAD', kind: 'product' });
  assert.equal(query.result.resources[0].data.epistemic_class, 'inferred',
    'public graphd proposals must remain agent-inferred');

  const simulationSession = await request('session.start');
  const simulationSpoof = await request('resource.propose', {
    session: simulationSession.result.id,
    resource: {
      id: 'simulation.spoofed',
      kind: 'persona_walk',
      data: {
        schema: 'lamina.persona-walk/v1',
        task_id: 'task.spoofed',
        coverage_digest: 'coverage.spoofed',
        workflow_ref: 'workflow.spoofed',
        persona_ref: 'persona.spoofed',
      },
    },
  });
  assert.equal(simulationSpoof.ok, true);
  const simulationSpoofPublish = await request('session.publish', {
    id: simulationSession.result.id,
  });
  assert.equal(simulationSpoofPublish.ok, false);
  assert.equal(simulationSpoofPublish.error.code, 'LAMINA_VALIDATION_FAILED',
    'caller-authored Resources must not spoof engine-recorded Persona simulations');
  assert.equal((await request('session.abort', { id: simulationSession.result.id })).ok, true);

  await new Promise((resolve) => {
    const socket = net.createConnection(endpoint);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({
        id: 'abandoned-response',
        method: 'graph.query',
        params: { at: 'HEAD' },
        cwd: root,
        auth,
      })}\n`);
      socket.destroy();
      resolve();
    });
    socket.on('error', resolve);
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(server.exitCode, null, 'an abandoned client response must not crash graphd');
  assert.equal((await request('ping')).ok, true);

  const spoof = await request('intent.resource.propose', {
    session: session.result.id,
    resource: { id: 'product.spoofed', kind: 'product', data: {} },
  });
  assert.equal(spoof.ok, false);
  assert.equal(spoof.error.code, 'LAMINA_BAD_REQUEST',
    'graphd must not expose a caller-selectable intended ingress');

  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-other-clone-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: otherRoot });
    execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: otherRoot });
    execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: otherRoot });
    fs.writeFileSync(path.join(otherRoot, 'README.md'), '# Other clone\n');
    execFileSync('git', ['add', 'README.md'], { cwd: otherRoot });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: otherRoot });
    const crossClone = await new Promise((resolve, reject) => {
      const socket = net.createConnection(endpoint);
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(`${JSON.stringify({
        id: 'cross-clone',
        method: 'status',
        params: {},
        cwd: otherRoot,
        auth,
      })}\n`));
      socket.on('data', (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline !== -1) {
          socket.end();
          resolve(JSON.parse(buffer.slice(0, newline)));
        }
      });
      socket.on('error', reject);
    });
    assert.equal(crossClone.ok, false);
    assert.equal(crossClone.error.code, 'LAMINA_BAD_REQUEST');
  } finally {
    fs.rmSync(otherRoot, { recursive: true, force: true });
  }
} finally {
  try { await request('shutdown'); } catch {}
  if (server.exitCode === null) await once(server, 'exit');
  assert.equal(fs.existsSync(paths.lock), false, 'graceful shutdown must remove its lock');
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('graphd_protocol_test: ok');
