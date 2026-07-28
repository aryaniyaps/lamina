#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
import { parseDaemonLock, runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-greenfield-'));
const cli = path.resolve('packages/cli/bin/lamina.mjs');
let daemonPid = null;

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

try {
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  fs.writeFileSync(path.join(root, 'README.md'), '# Greenfield\n');

  const doctor = run(['doctor', '--json']);
  assert.equal(doctor.git.is_project, true);
  assert.equal(doctor.git.unborn, true);
  assert.equal(doctor.git.branch, 'main');
  assert.equal(doctor.git.revision, null);
  assert.match(doctor.git.source_revision, /^unborn:tree_/);
  assert.notEqual(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root }).status, 0);

  const status = run(['graph', 'status']);
  assert.equal(status.branch, 'main');
  const session = run(['session', 'start']);
  const published = run(['session', 'publish', session.id]);
  assert.ok(published.graph_version);
  assert.notEqual(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root }).status, 0);
  daemonPid = parseDaemonLock(fs.readFileSync(path.join(root, '.git', 'lamina', 'graphd.lock'), 'utf8'))?.pid;
} finally {
  if (daemonPid) {
    try { await stopIncompatibleServer(runtimePaths(root), daemonPid); } catch {}
  }
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('greenfield_cli_test: ok');
