#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  graphRequest,
  stopIncompatibleServer,
} from '../packages/cli/lib/graph-runtime/client.mjs';
import {
  parseDaemonLock,
  runtimePaths,
} from '../packages/cli/lib/graph-runtime/util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-observation-cli-'));
const cli = path.resolve('packages/cli/bin/lamina.mjs');
execFileSync('git', ['init', '-b', 'main'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
fs.writeFileSync(path.join(root, 'README.md'), '# Observation fixture\n');
execFileSync('git', ['add', 'README.md'], { cwd: root });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

const paths = runtimePaths(root);
let daemonPid = null;
try {
  let result = spawnSync(process.execPath, [cli, 'graph', 'observe'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const firstGeneration = fs.readFileSync(
    path.join(paths.cocoindex, 'target-generation'),
    'utf8',
  ).trim();
  const first = await graphRequest('observation.status', {
    product: paths.product,
    generation: firstGeneration,
  }, root);
  assert.equal(first.exists, true);
  assert.equal(first.count, 1);

  const noUvBin = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-no-uv-'));
  const noUvEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path'),
  );
  noUvEnvironment.PATH = noUvBin;
  result = spawnSync(process.execPath, [cli, 'graph', 'rebuild-observations'], {
    cwd: root,
    encoding: 'utf8',
    env: noUvEnvironment,
    timeout: 180_000,
  });
  fs.rmSync(noUvBin, { recursive: true, force: true });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const unavailable = JSON.parse(result.stderr);
  assert.equal(unavailable.error.code, 'LAMINA_OBSERVATION_UNAVAILABLE');
  assert.equal(
    fs.readFileSync(path.join(paths.cocoindex, 'target-generation'), 'utf8').trim(),
    firstGeneration,
    'rebuild must not invalidate the current generation before its runtime preflight passes',
  );
  const retained = await graphRequest('observation.status', {
    product: paths.product,
    generation: firstGeneration,
  }, root);
  assert.deepEqual(retained, first);

  result = spawnSync(process.execPath, [cli, 'graph', 'rebuild-observations'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const secondGeneration = fs.readFileSync(
    path.join(paths.cocoindex, 'target-generation'),
    'utf8',
  ).trim();
  assert.notEqual(secondGeneration, firstGeneration);
  const rebuilt = await graphRequest('observation.status', {
    product: paths.product,
    generation: secondGeneration,
  }, root);
  assert.equal(rebuilt.exists, true);
  assert.equal(rebuilt.count, 1);
  assert.equal(
    fs.existsSync(path.resolve('packages/cli/__pycache__')),
    false,
    'observation must not write Python caches into the installed npm package',
  );
  daemonPid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid;
} finally {
  if (!daemonPid) {
    try { daemonPid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid; } catch {}
  }
  if (daemonPid) {
    try { await stopIncompatibleServer(paths, daemonPid); } catch {}
  }
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('observation_cli_test: ok');
