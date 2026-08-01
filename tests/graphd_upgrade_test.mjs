#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  exchange,
  graphRequest,
  stopIncompatibleServer,
} from '../packages/cli/lib/graph-runtime/client.mjs';
import {
  ensureAuthToken,
  graphSocketPath,
  parseDaemonLock,
  runtimePaths,
} from '../packages/cli/lib/graph-runtime/util.mjs';
import { removeTemporaryTree } from './test-util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-graphd-upgrade-'));
const cli = path.resolve('packages/cli/bin/lamina.mjs');
execFileSync('git', ['init', '-b', 'main'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
fs.writeFileSync(path.join(root, 'README.md'), '# Upgrade fixture\n');
execFileSync('git', ['add', 'README.md'], { cwd: root });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

const paths = runtimePaths(root);
const token = ensureAuthToken(paths);
const seedSource = `
  import { GraphEngine } from ${JSON.stringify(
    new URL('../packages/cli/lib/graph-runtime/engine.mjs', import.meta.url).href
  )};
  import { runtimePaths } from ${JSON.stringify(
    new URL('../packages/cli/lib/graph-runtime/util.mjs', import.meta.url).href
  )};
  const root = process.env.LAMINA_TEST_ROOT;
  const engine = new GraphEngine(runtimePaths(root));
  const context = engine.currentContext(root);
  const session = engine.startSession({
    branch: context.branch,
    source_revision: context.source_revision,
  });
  for (const resource of [
    { id: 'product.preserved', kind: 'product', data: { name: 'Preserved' } },
    { id: 'persona.preserved', kind: 'persona', data: { name: 'Preserved user' } },
    { id: 'actor.preserved', kind: 'actor', data: { name: 'Preserved owner' } },
  ]) engine.stageResource(session.id, resource);
  engine.publishSession(session.id, context.source_revision);
  engine.close();
`;
execFileSync(process.execPath, ['--input-type=module', '--eval', seedSource], {
  env: { ...process.env, LAMINA_TEST_ROOT: root },
});

const endpoint = graphSocketPath(paths);

function runCli(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: process.env,
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

async function startFake(identity) {
  const fakeSource = `
    const fs = require('node:fs');
    const net = require('node:net');
    const endpoint = process.env.LAMINA_TEST_ENDPOINT;
    const lock = process.env.LAMINA_TEST_LOCK;
    const identity = JSON.parse(process.env.LAMINA_TEST_IDENTITY);
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(endpoint); } catch {}
    }
    fs.writeFileSync(lock, JSON.stringify({ ...identity, pid: process.pid }) + '\\n');
    const server = net.createServer((socket) => {
      let input = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        input += chunk;
        const newline = input.indexOf('\\n');
        if (newline === -1) return;
        const request = JSON.parse(input.slice(0, newline));
        const result = request.method === 'observation.status'
          ? {
              exists: true,
              view: 'observation:legacy',
              generation: request.params.generation,
              count: 185,
              source_revisions: ['legacy-revision'],
            }
          : { ...identity, pid: process.pid };
        socket.end(JSON.stringify({ id: request.id, ok: true, result }) + '\\n');
        if (request.method === 'shutdown') setImmediate(close);
      });
    });
    function close() {
      server.close();
      if (process.platform !== 'win32') {
        try { fs.unlinkSync(endpoint); } catch {}
      }
      try { fs.unlinkSync(lock); } catch {}
      process.exit(0);
    }
    process.on('SIGTERM', close);
    server.listen(endpoint, () => process.stdout.write('ready\\n'));
  `;
  const fake = spawn(process.execPath, ['-e', fakeSource], {
    env: {
      ...process.env,
      LAMINA_TEST_ENDPOINT: endpoint,
      LAMINA_TEST_LOCK: paths.lock,
      LAMINA_TEST_IDENTITY: JSON.stringify(identity),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let fakeError = '';
  fake.stderr.on('data', (chunk) => { fakeError += chunk; });
  await Promise.race([
    new Promise((resolve, reject) => {
      fake.stdout.once('data', resolve);
      fake.once('exit', () => reject(new Error(`fake graphd exited: ${fakeError}`)));
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('fake graphd did not start')),
      10_000,
    )),
  ]);
  return fake;
}

let fake = null;
try {
  // Reproduce the 0.1.12 incident: protocol 3 returns a superficially complete
  // status but omits source_key_count. The 0.1.13 client must replace it before
  // observing, without rebuilding or deleting the canonical graph.
  fake = await startFake({
    protocol_version: 3,
    runtime_version: '0.1.12',
    capabilities: [],
  });
  const legacyStatus = await exchange(endpoint, {
    id: 'legacy-status',
    method: 'observation.status',
    params: { generation: 'legacy-generation' },
    cwd: root,
    auth: token,
  });
  assert.equal(legacyStatus.result.count, 185);
  assert.equal(legacyStatus.result.source_key_count, undefined);

  const observed = await runCli(['graph', 'observe'], {
    env: { ...process.env, LAMINA_OBSERVATION_BACKEND: 'node' },
  });
  assert.equal(observed.status, 0, observed.stderr || observed.stdout);
  const observationResult = JSON.parse(observed.stdout);
  assert.equal(observationResult.observed.count, observationResult.observed.source_key_count);
  if (fake.exitCode === null) await once(fake, 'exit');

  const query = await graphRequest('graph.query', { at: 'HEAD' }, root);
  for (const id of ['product.preserved', 'persona.preserved', 'actor.preserved']) {
    assert.ok(query.resources.some((resource) => resource.id === id),
      `protocol upgrade must preserve ${id}`);
  }

  let lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
  assert.equal(lock.protocol_version, 9);
  assert.equal(lock.runtime_version, '0.3.6');
  assert.deepEqual(lock.capabilities, [
    'observation.status.source_key_count',
    'observation.status.generation',
    'retrieval.hybrid.v1',
    'work.context.v5',
    'design.persona-walk.v1',
    'work.persona-case-map.v4',
    'mission.persona-case-evidence.v4',
  ]);

  await stopIncompatibleServer(paths, lock.pid);

  // Storage fixes can require a process upgrade without changing the wire
  // protocol. A daemon from the previous CLI release must not keep the old
  // embedded database runtime alive merely because its capabilities match.
  fake = await startFake({
    protocol_version: 9,
    runtime_version: '0.1.17',
    capabilities: [
      'observation.status.source_key_count',
      'observation.status.generation',
      'retrieval.hybrid.v1',
      'work.context.v5',
      'design.persona-walk.v1',
      'work.persona-case-map.v4',
      'mission.persona-case-evidence.v4',
    ],
  });
  const upgradedRuntimeQuery = await graphRequest(
    'graph.query',
    { at: 'HEAD', kind: 'product' },
    root,
  );
  assert.ok(upgradedRuntimeQuery.resources.some(
    (resource) => resource.id === 'product.preserved',
  ));
  if (fake.exitCode === null) await once(fake, 'exit');
  lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
  assert.equal(lock.runtime_version, '0.3.6');
  await stopIncompatibleServer(paths, lock.pid);

  // Even a daemon that claims the required capabilities is replaced if its
  // actual status response violates the contract. Existing active observation
  // Resources remain sufficient after replacement; no rebuild is needed.
  fake = await startFake({
    protocol_version: 9,
    runtime_version: '0.3.0',
    capabilities: [
      'observation.status.source_key_count',
      'observation.status.generation',
      'retrieval.hybrid.v1',
      'work.context.v5',
      'design.persona-walk.v1',
      'work.persona-case-map.v4',
      'mission.persona-case-evidence.v4',
    ],
  });
  const recoveredMalformedStatus = await runCli(['graph', 'observe'], {
    env: { ...process.env, LAMINA_OBSERVATION_BACKEND: 'node' },
  });
  assert.equal(
    recoveredMalformedStatus.status,
    0,
    recoveredMalformedStatus.stderr || recoveredMalformedStatus.stdout,
  );
  if (fake.exitCode === null) await once(fake, 'exit');
  lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
  await stopIncompatibleServer(paths, lock.pid);

  // Protocol equality alone is insufficient. A protocol-9 process without the
  // status capabilities must also be recycled.
  fake = await startFake({
    protocol_version: 9,
    runtime_version: '0.3.0',
    capabilities: [],
  });
  const secondQuery = await graphRequest('graph.query', { at: 'HEAD', kind: 'product' }, root);
  assert.ok(secondQuery.resources.some((resource) => resource.id === 'product.preserved'));
  if (fake.exitCode === null) await once(fake, 'exit');
  lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
  assert.equal(lock.protocol_version, 9);
  assert.ok(lock.capabilities.includes('observation.status.source_key_count'));
} finally {
  try {
    if (fake?.exitCode === null) {
      fake.kill('SIGTERM');
      await once(fake, 'exit');
    }
    let finalLock = null;
    try {
      finalLock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (finalLock?.pid) await stopIncompatibleServer(paths, finalLock.pid);
  } finally {
    removeTemporaryTree(root);
  }
}

console.log('graphd_upgrade_test: ok');
