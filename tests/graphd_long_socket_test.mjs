#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphRequest } from '../skills/lamina-orchestrator/lib/graph-runtime/client.mjs';
import { graphSocketPath, runtimePaths } from '../skills/lamina-orchestrator/lib/graph-runtime/util.mjs';

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
  assert.ok(Buffer.byteLength(paths.socket) >= 108, 'fixture must exceed the Unix socket pathname limit');
  const endpoint = graphSocketPath(paths);
  assert.ok(Buffer.byteLength(endpoint) < 108);
  if (fs.existsSync('/proc/self/fd')) {
    assert.match(endpoint, /^\/proc\/self\/fd\/\d+\/graphd\.sock$/);
  }
  const status = await graphRequest('status', {}, root);
  assert.equal(status.branch, 'main');
  assert.ok(fs.existsSync(paths.socket), 'short alias must still create the canonical clone-local socket entry');
  const pid = Number(fs.readFileSync(paths.lock, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 1) process.kill(pid, 'SIGTERM');
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

console.log('graphd_long_socket_test: ok');
