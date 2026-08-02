#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  graphRequest,
  stopIncompatibleServer,
} from '../packages/cli/lib/graph-runtime/client.mjs';
import {
  graphSocketChildPath,
  graphSocketPath,
  parseDaemonLock,
  runtimePaths,
} from '../packages/cli/lib/graph-runtime/util.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-long-socket-'));
const root = path.join(base, 'a'.repeat(70), 'b'.repeat(40));
fs.mkdirSync(root, { recursive: true });
execFileSync('git', ['init', '-b', 'main'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
fs.writeFileSync(path.join(root, 'README.md'), '# Long socket fixture\n');
execFileSync('git', ['add', 'README.md'], { cwd: root });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

try {
  const paths = runtimePaths(root);
  const endpoint = graphSocketPath(paths);
  const childEndpoint = graphSocketChildPath(paths);
  if (process.platform !== 'win32') {
    const fallbackEndpoint = graphSocketPath(paths, 'darwin');
    assert.equal(graphSocketChildPath(paths, 'darwin'), fallbackEndpoint,
      'repeated fallback alias resolution must retain one canonical live target');
  }
  if (process.platform === 'win32') {
    assert.match(endpoint, /^\\\\\.\\pipe\\laminadev-[a-f0-9]{24}$/);
  } else {
    assert.ok(Buffer.byteLength(paths.socket) >= 108, 'fixture must exceed the Unix socket pathname limit');
    assert.ok(Buffer.byteLength(endpoint) < 108);
    assert.ok(Buffer.byteLength(childEndpoint) < 108);
    assert.equal(fs.realpathSync(path.dirname(childEndpoint)), fs.realpathSync(paths.runtime_dir));
    if (fs.existsSync('/proc/self/fd')) {
      assert.match(endpoint, /^\/proc\/self\/fd\/\d+\/graphd\.sock$/);
      assert.match(childEndpoint, new RegExp(`^/proc/${process.pid}/fd/\\d+/graphd\\.sock$`));
      const childResolved = execFileSync(process.execPath, ['-e',
        'process.stdout.write(require("node:fs").realpathSync(process.env.ENDPOINT_DIRECTORY))'], {
        env: { ...process.env, ENDPOINT_DIRECTORY: path.dirname(childEndpoint) },
        encoding: 'utf8',
      });
      assert.equal(childResolved, fs.realpathSync(paths.runtime_dir),
        'an exec child must reach the canonical runtime directory through the parent descriptor');
    }
  }
  const status = await graphRequest('status', {}, root);
  assert.equal(status.branch, 'main');
  if (process.platform !== 'win32') {
    assert.ok(fs.existsSync(paths.socket), 'short alias must still create the canonical clone-local socket entry');
    if (fs.existsSync('/proc/self/fd')) {
      const childResponse = execFileSync(process.execPath, ['-e', `
        const fs = require('node:fs');
        const net = require('node:net');
        const socket = net.createConnection(process.env.ENDPOINT);
        let received = '';
        socket.setEncoding('utf8');
        socket.setTimeout(2000, () => socket.destroy(new Error('timeout')));
        socket.on('connect', () => socket.write(JSON.stringify({
          id: 'long-socket-child', method: 'status', params: {},
          cwd: process.env.REPOSITORY,
          auth: fs.readFileSync(process.env.TOKEN, 'utf8').trim(),
        }) + '\\n'));
        socket.on('data', (chunk) => {
          received += chunk;
          if (!received.includes('\\n')) return;
          const response = JSON.parse(received.slice(0, received.indexOf('\\n')));
          if (!response.ok) throw new Error(response.error?.message || 'request refused');
          process.stdout.write(JSON.stringify(response.result));
          socket.end();
        });
        socket.on('error', (error) => { console.error(error.message); process.exit(2); });
      `], {
        env: {
          ...process.env, ENDPOINT: childEndpoint, REPOSITORY: root, TOKEN: paths.token,
        },
        encoding: 'utf8', timeout: 5_000,
      });
      assert.equal(JSON.parse(childResponse).branch, 'main',
        'an exec child must complete a graph request through the parent descriptor endpoint');
    }
  }
  const pid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid;
  if (Number.isInteger(pid) && pid > 1) await stopIncompatibleServer(paths, pid);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

console.log('graphd_long_socket_test: ok');
