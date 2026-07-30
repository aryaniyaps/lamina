#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  digest,
  ensureAuthToken,
  graphSocketPath,
  runtimePaths,
} from '../packages/cli/lib/graph-runtime/util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-graphd-durability-'));
execFileSync('git', ['init', '-b', 'main'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
fs.writeFileSync(path.join(root, 'README.md'), '# Durability fixture\n');
execFileSync('git', ['add', 'README.md'], { cwd: root });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

const paths = runtimePaths(root);
const endpoint = graphSocketPath(paths);
const serverPath = path.resolve('packages/cli/lib/graph-runtime/server.mjs');
const auth = ensureAuthToken(paths);

function start() {
  const child = spawn(process.execPath, [serverPath, root], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return { child, stderr: () => stderr };
}

function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({
      id: `${method}-${Date.now()}`,
      method,
      params,
      cwd: root,
      auth,
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

async function ready(server) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`graphd exited early: ${server.stderr()}`);
    }
    try {
      const response = await request('ping');
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`graphd did not listen at ${endpoint}`);
}

let server = start();
try {
  await ready(server);
  const session = await request('session.start');
  assert.equal(session.ok, true);
  assert.equal((await request('resource.propose', {
    session: session.result.id,
    resource: {
      id: 'product.durable',
      kind: 'product',
      data: { name: 'Durable graph product' },
    },
  })).ok, true);
  assert.equal((await request('session.publish', { id: session.result.id })).ok, true);
  assert.equal(
    fs.existsSync(`${paths.database}.wal`),
    false,
    'an acknowledged publication must be checkpointed',
  );

  const generation = fs.readFileSync(path.join(paths.cocoindex, 'target-generation'), 'utf8').trim();
  const snapshot = {
    product: paths.product,
    source_revision: 'source:durability',
    source_root: root,
  };
  const observation = {
    source_snapshot: snapshot,
    source_key: 'README.md',
    content_hash: 'content:durability',
    extractor: { id: 'durability-test', version: '1' },
    payload: { brownfield: { categories: ['durability'] } },
  };
  observation.id = digest('observation', {
    snapshot: observation.source_snapshot,
    source_key: observation.source_key,
    content_hash: observation.content_hash,
    extractor: observation.extractor,
    payload: observation.payload,
  });
  const observed = await request('observation.apply', {
    snapshot,
    upserts: [observation],
    deletes: [],
    generation,
  });
  assert.equal(observed.ok, true);
  assert.equal(observed.result.committed, true);
  assert.equal(
    fs.existsSync(`${paths.database}.wal`),
    false,
    'an acknowledged observation batch must be checkpointed',
  );

  const invalidated = await request('observation.invalidate', { product: paths.product });
  assert.equal(invalidated.ok, true);
  assert.equal(
    fs.existsSync(`${paths.database}.wal`),
    false,
    'an acknowledged observation invalidation must be checkpointed',
  );

  server.child.kill('SIGKILL');
  await once(server.child, 'exit');
  server = start();
  await ready(server);
  const query = await request('graph.query', { at: 'HEAD', kind: 'product' });
  assert.equal(query.ok, true);
  assert.equal(query.result.resources[0]?.id, 'product.durable',
    'a committed graph transaction must survive abrupt graphd replacement');
} finally {
  try { await request('shutdown'); } catch {}
  if (server.child.exitCode === null) await once(server.child, 'exit');
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('graphd_durability_test: ok');
