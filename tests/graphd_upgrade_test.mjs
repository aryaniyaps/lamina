#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  graphRequest,
  stopIncompatibleServer,
} from '../packages/cli/lib/graph-runtime/client.mjs';
import {
  graphSocketPath,
  parseDaemonLock,
  runtimePaths,
} from '../packages/cli/lib/graph-runtime/util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-graphd-upgrade-'));
execFileSync('git', ['init', '-b', 'main'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
fs.writeFileSync(path.join(root, 'README.md'), '# Upgrade fixture\n');
execFileSync('git', ['add', 'README.md'], { cwd: root });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

const paths = runtimePaths(root);
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
  engine.stageResource(session.id, {
    id: 'product.preserved',
    kind: 'product',
    data: { name: 'Preserved' },
  });
  engine.publishSession(session.id, context.source_revision);
  engine.close();
`;
execFileSync(process.execPath, ['--input-type=module', '--eval', seedSource], {
  env: { ...process.env, LAMINA_TEST_ROOT: root },
});

const endpoint = graphSocketPath(paths);
const fakeSource = `
  const fs = require('node:fs');
  const net = require('node:net');
  const endpoint = process.env.LAMINA_TEST_ENDPOINT;
  const lock = process.env.LAMINA_TEST_LOCK;
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(endpoint); } catch {}
  }
  fs.writeFileSync(lock, process.pid + '\\n');
  const server = net.createServer((socket) => {
    let input = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      input += chunk;
      const newline = input.indexOf('\\n');
      if (newline === -1) return;
      const request = JSON.parse(input.slice(0, newline));
      socket.end(JSON.stringify({
        id: request.id,
        ok: true,
        result: { protocol_version: 2, pid: process.pid }
      }) + '\\n');
    });
  });
  function close() {
    server.close(() => {
      if (process.platform !== 'win32') {
        try { fs.unlinkSync(endpoint); } catch {}
      }
      try { fs.unlinkSync(lock); } catch {}
      process.exit(0);
    });
  }
  process.on('SIGTERM', close);
  server.listen(endpoint, () => process.stdout.write('ready\\n'));
`;
const fake = spawn(process.execPath, ['-e', fakeSource], {
  env: {
    ...process.env,
    LAMINA_TEST_ENDPOINT: endpoint,
    LAMINA_TEST_LOCK: paths.lock,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let fakeError = '';
fake.stderr.on('data', (chunk) => { fakeError += chunk; });

try {
  await Promise.race([
    new Promise((resolve, reject) => {
      fake.stdout.once('data', resolve);
      fake.once('exit', () => reject(new Error(`fake v2 graphd exited: ${fakeError}`)));
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('fake v2 graphd did not start')),
      10_000,
    )),
  ]);

  const query = await graphRequest('graph.query', {
    at: 'HEAD',
    kind: 'product',
  }, root);
  assert.ok(
    query.resources.some((resource) => resource.id === 'product.preserved'),
    'protocol upgrade must preserve the existing Ladybug graph',
  );
  if (fake.exitCode === null) await once(fake, 'exit');
  assert.notEqual(fake.exitCode, null, 'incompatible daemon must be stopped');
  assert.match(fs.readFileSync(paths.token, 'utf8').trim(), /^[a-f0-9]{64}$/);
  const lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
  assert.equal(lock.protocol_version, 3);
} finally {
  if (fake.exitCode === null) {
    fake.kill('SIGTERM');
    await once(fake, 'exit');
  }
  try {
    const lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
    if (lock?.pid) await stopIncompatibleServer(paths, lock.pid);
  } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('graphd_upgrade_test: ok');
