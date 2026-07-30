#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
import { parseDaemonLock, runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
import { removeTemporaryTree } from './test-util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-observation-reconcile-'));
const cli = path.resolve('packages/cli/bin/lamina.mjs');
const source = path.join(root, 'src');
let daemonPid = null;

function observe(args = ['graph', 'observe']) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, LAMINA_OBSERVATION_BACKEND: 'node' },
    timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

try {
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  fs.mkdirSync(source);
  for (let index = 0; index < 276; index += 1) {
    fs.writeFileSync(path.join(source, `file-${String(index).padStart(3, '0')}.txt`), `source ${index}\n`);
  }

  const first = observe();
  assert.equal(first.observed.count, 276);
  assert.equal(first.observed.source_key_count, 276);
  assert.equal(first.observed.resource_ids.length, 276);

  const unchanged = observe();
  assert.equal(unchanged.observed.count, 276);
  assert.equal(unchanged.observed.source_key_count, 276);

  for (let index = 0; index < 91; index += 1) {
    fs.rmSync(path.join(source, `file-${String(index).padStart(3, '0')}.txt`));
  }
  fs.writeFileSync(path.join(source, 'file-091.txt'), 'changed source 91\n');

  const reconciled = observe();
  assert.equal(reconciled.observed.count, 185);
  assert.equal(reconciled.observed.source_key_count, 185);
  assert.equal(new Set(reconciled.observed.resource_ids).size, 185);
  assert.deepEqual(reconciled.observed.source_revisions, [runtimePaths(root).source_revision]);

  const rebuilt = observe(['graph', 'rebuild-observations']);
  assert.equal(rebuilt.observed.count, 185);
  assert.equal(rebuilt.observed.source_key_count, 185);
  assert.deepEqual(rebuilt.observed.source_revisions, [runtimePaths(root).source_revision]);

  daemonPid = parseDaemonLock(fs.readFileSync(runtimePaths(root).lock, 'utf8'))?.pid;
} finally {
  if (daemonPid) {
    try { await stopIncompatibleServer(runtimePaths(root), daemonPid); } catch {}
  }
  removeTemporaryTree(root);
}

console.log('observation_reconciliation_test: ok');
