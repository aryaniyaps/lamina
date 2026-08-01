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
import { removeTemporaryTree } from './test-util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-observation-cli-'));
const cli = path.resolve('packages/cli/bin/lamina.mjs');
execFileSync('git', ['init', '-b', 'main'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
fs.writeFileSync(path.join(root, 'README.md'), '# Observation fixture\n');
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
  scripts: { start: 'node src/server.js' },
  dependencies: { express: '^5.0.0' },
}));
fs.mkdirSync(path.join(root, 'src'));
fs.writeFileSync(
  path.join(root, 'src', 'server.js'),
  "const FEATURE_CHECKOUT = true;\napp.get('/orders', function ordersHandler() { requireAuth(); emit('order.created'); });\n",
);
fs.mkdirSync(path.join(root, 'docs'));
fs.writeFileSync(path.join(root, 'docs', 'personas.md'), '# Owner persona\n');
fs.mkdirSync(path.join(root, '.lamina', 'runs', 'legacy'), { recursive: true });
fs.writeFileSync(path.join(root, '.lamina', 'business-context.md'), '# Business context\n');
fs.writeFileSync(path.join(root, '.lamina', 'personas.json'), JSON.stringify([{ name: 'Owner' }]));
fs.writeFileSync(path.join(root, '.lamina', 'runs', 'legacy', 'run.json'), '{"legacy":true}\n');
execFileSync('git', ['add', '.'], { cwd: root });
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
  assert.equal(first.count, 6);
  assert.equal(first.coverage.routes, 1);
  assert.equal(first.coverage.handlers, 1);
  assert.equal(first.coverage.permissions, 1);
  assert.equal(first.coverage.feature_flags, 1);
  assert.equal(first.coverage.personas, 2);
  assert.ok(first.limitations.some((item) => item.includes('do not prove runtime')));
  const observations = await graphRequest('graph.query', {
    at: first.view,
    kind: 'observation',
  }, root);
  const serverObservation = observations.resources.find((item) =>
    item.data?.path === 'src/server.js' || item.data?.path?.endsWith('/src/server.js'));
  assert.ok(serverObservation, `missing server observation in ${JSON.stringify(observations.resources.map((item) => item.data?.path))}`);
  assert.deepEqual(serverObservation.data.payload.brownfield.signals.routes, ['/orders']);
  assert.deepEqual(serverObservation.data.payload.brownfield.signals.handlers, ['ordersHandler']);
  assert.ok(observations.resources.some((item) => item.data?.path === '.lamina/business-context.md'));
  assert.ok(observations.resources.some((item) => item.data?.path === '.lamina/personas.json'));
  assert.ok(!observations.resources.some((item) => item.data?.path?.endsWith('/run.json')),
    'legacy run directories must remain excluded from source evidence');

  // Agent-specific skills can add hidden/directive folders after the first
  // pass. A new source snapshot must replace records by source key instead of
  // retaining duplicates from the prior snapshot.
  fs.mkdirSync(path.join(root, '.agents'));
  fs.writeFileSync(path.join(root, '.agents', 'rules.md'), '# Agent rules\n');
  fs.mkdirSync(path.join(root, '.agents', 'skills', 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'skills', 'fixture', 'SKILL.md'), '# Installed skill noise\n');
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude', 'settings.md'), '# Claude settings\n');
  fs.mkdirSync(path.join(root, '.lamina', 'runtime-cli'), { recursive: true });
  fs.writeFileSync(path.join(root, '.lamina', 'runtime-cli', 'lamina'), 'runtime noise\n');
  fs.mkdirSync(path.join(root, 'agent'));
  fs.writeFileSync(path.join(root, 'agent', 'settings.json'), '{}\n');
  result = spawnSync(process.execPath, [cli, 'graph', 'observe'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const afterInstallerArtifacts = await graphRequest('observation.status', {
    product: paths.product,
    generation: firstGeneration,
  }, root);
  assert.equal(afterInstallerArtifacts.count, 9);
  assert.equal(afterInstallerArtifacts.source_key_count, 9);
  assert.deepEqual(afterInstallerArtifacts.source_revisions, [runtimePaths(root).source_revision]);
  const afterInstallerResources = await graphRequest('graph.query', {
    at: afterInstallerArtifacts.view,
    kind: 'observation',
  }, root);
  assert.ok(!afterInstallerResources.resources.some((item) =>
    item.data?.path?.includes('/skills/') || item.data?.path?.includes('runtime-cli')),
  'installed agent skills and Lamina runtime files must not enter product-code retrieval');

  fs.writeFileSync(
    path.join(root, 'src', 'server.js'),
    "app.post('/orders', function createOrderHandler() { authorize(); emit('order.created'); });\n",
  );
  fs.rmSync(path.join(root, 'docs', 'personas.md'));
  fs.writeFileSync(path.join(root, 'src', 'schema.ts'), 'interface Order { id: string; status: \"created\" }\n');
  result = spawnSync(process.execPath, [cli, 'graph', 'discover', '--brownfield'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const discovery = JSON.parse(result.stdout);
  assert.equal(discovery.mode, 'discover');
  assert.equal(discovery.discovery_report.extractor_coverage.routes, 1);
  assert.equal(discovery.discovery_report.extractor_coverage.schemas, 1);
  assert.ok(discovery.discovery_report.ignored_patterns.includes('**/.lamina/runs/**'));
  assert.deepEqual(discovery.observed.source_revisions, [runtimePaths(root).source_revision]);
  assert.equal(discovery.observed.count, 9);

  // The shipped standalone observer uses managed CocoIndex assets. Source
  // checkout coverage retains its locked uv runner for development only.
  result = spawnSync(process.execPath, [cli, 'graph', 'rebuild-observations'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const noUvRebuild = JSON.parse(result.stdout);
  assert.equal(noUvRebuild.backend, 'cocoindex');
  assert.equal(noUvRebuild.invalidation.invalidated, true);
  const firstGenerationAfterManagedRebuild = fs.readFileSync(path.join(paths.cocoindex, 'target-generation'), 'utf8').trim();
  assert.notEqual(firstGenerationAfterManagedRebuild, firstGeneration);
  const retained = await graphRequest('observation.status', {
    product: paths.product,
    generation: firstGenerationAfterManagedRebuild,
  }, root);
  assert.equal(retained.count, discovery.observed.count);

  fs.writeFileSync(path.join(root, 'crash-retry.txt'), 'retry target state\n');
  result = spawnSync(process.execPath, [cli, 'graph', 'observe'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, LAMINA_TEST_OBSERVATION_CRASH_AFTER_COMMIT: '1' },
    timeout: 180_000,
  });
  assert.notEqual(result.status, 0, 'the injected CocoIndex crash must interrupt target-state tracking');
  result = spawnSync(process.execPath, [cli, 'graph', 'observe'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const retried = await graphRequest('observation.status', {
    product: paths.product,
    generation: firstGenerationAfterManagedRebuild,
  }, root);
  assert.equal(retried.count, 10);
  assert.deepEqual(retried.source_revisions, [runtimePaths(root).source_revision]);

  // Only Linux has a non-reusable process identity that permits automatic
  // crash-stale graphd replacement. Portable runtimes deliberately fail
  // closed after an ungraceful daemon exit.
  if (process.platform === 'linux') {
    daemonPid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid;
    process.kill(daemonPid, 'SIGKILL');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        process.kill(daemonPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 20));
      } catch {
        break;
      }
    }
  }
  fs.writeFileSync(path.join(root, 'graphd-recovery-probe.txt'), 'probe graphd recovery\n');
  result = spawnSync(process.execPath, [cli, 'graph', 'observe'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const afterGraphdRecoveryProbe = await graphRequest('observation.status', {
    product: paths.product,
    generation: firstGenerationAfterManagedRebuild,
  }, root);
  assert.equal(afterGraphdRecoveryProbe.count, 11);
  assert.deepEqual(afterGraphdRecoveryProbe.source_revisions, [runtimePaths(root).source_revision]);

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
  assert.notEqual(secondGeneration, firstGenerationAfterManagedRebuild);
  const rebuilt = await graphRequest('observation.status', {
    product: paths.product,
    generation: secondGeneration,
  }, root);
  assert.equal(rebuilt.exists, true);
  assert.equal(rebuilt.count, 11);
  assert.equal(
    fs.existsSync(path.resolve('packages/cli/__pycache__')),
    false,
    'observation must not write Python caches into the standalone CLI source',
  );
  daemonPid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid;
} finally {
  if (!daemonPid) {
    try { daemonPid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid; } catch {}
  }
  if (daemonPid) {
    try { await stopIncompatibleServer(paths, daemonPid); } catch {}
  }
  removeTemporaryTree(root);
}

console.log('observation_cli_test: ok');
