#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
import { parseDaemonLock, runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
import { CLI_VERSION } from '../packages/cli/lib/runtime-identity.mjs';
import {
  applyRepositoryUpgrade,
  evaluateRepositoryCutover,
  invalidateDerivedStores,
  readRuntimeIdentity,
  runtimeIdentityPath,
  SUPPORTED_LAYOUT_VERSION,
} from '../packages/cli/lib/runtime-lifecycle.mjs';
import { removeTemporaryTree } from './test-util.mjs';

const cli = path.resolve('packages/cli/bin/lamina.mjs');

function initFixture(root) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'README.md'), '# cutover\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
}

function seedGraph(root) {
  const seedSource = `
    import { GraphEngine } from ${JSON.stringify(
      new URL('../packages/cli/lib/graph-runtime/engine.mjs', import.meta.url).href,
    )};
    import { runtimePaths } from ${JSON.stringify(
      new URL('../packages/cli/lib/graph-runtime/util.mjs', import.meta.url).href,
    )};
    const engine = new GraphEngine(runtimePaths(process.env.LAMINA_TEST_ROOT));
    const context = engine.currentContext(process.env.LAMINA_TEST_ROOT);
    const session = engine.startSession({
      branch: context.branch,
      source_revision: context.source_revision,
    });
    engine.stageResource(session.id, {
      id: 'product.cutover',
      kind: 'product',
      data: { name: 'Cutover product' },
    });
    engine.publishSession(session.id, context.source_revision);
    engine.close();
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', seedSource], {
    env: { ...process.env, LAMINA_TEST_ROOT: root },
  });
}

const compatibleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-cutover-compatible-'));
initFixture(compatibleRoot);
seedGraph(compatibleRoot);
const compatiblePaths = runtimePaths(compatibleRoot);
fs.writeFileSync(
  runtimeIdentityPath(compatibleRoot),
  `${JSON.stringify({
    schema: 'lamina.runtime-identity/v1',
    layout_version: SUPPORTED_LAYOUT_VERSION,
    cli_version: '0.3.0',
    protocol_version: 9,
    capabilities: [],
  }, null, 2)}\n`,
);
fs.mkdirSync(compatiblePaths.context, { recursive: true });
fs.writeFileSync(path.join(compatiblePaths.context, 'retrieval.lbdb'), 'stale-derived\n');
const graphBytesBefore = fs.statSync(compatiblePaths.database).size;

const upgraded = applyRepositoryUpgrade(compatibleRoot);
assert.equal(upgraded.canonical_graph_preserved, true);
assert.equal(fs.existsSync(compatiblePaths.database), true);
assert.equal(fs.statSync(compatiblePaths.database).size, graphBytesBefore);
assert.equal(readRuntimeIdentity(compatibleRoot).cli_version, CLI_VERSION);
assert.equal(fs.existsSync(path.join(compatiblePaths.context, 'retrieval.lbdb')), false);

const observed = spawnSync(process.execPath, [cli, 'graph', 'observe'], {
  cwd: compatibleRoot,
  encoding: 'utf8',
  env: { ...process.env, LAMINA_OBSERVATION_BACKEND: 'node' },
});
assert.equal(observed.status, 0, observed.stderr || observed.stdout);
const query = spawnSync(process.execPath, [cli, 'graph', 'query', '--kind', 'product'], {
  cwd: compatibleRoot,
  encoding: 'utf8',
});
assert.equal(query.status, 0, query.stderr);
assert.match(query.stdout, /product\.cutover/);

const incompatibleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-cutover-incompatible-'));
initFixture(incompatibleRoot);
seedGraph(incompatibleRoot);
const incompatiblePaths = runtimePaths(incompatibleRoot);
fs.mkdirSync(path.join(incompatiblePaths.runtime_dir, 'runs'), { recursive: true });
fs.writeFileSync(path.join(incompatiblePaths.runtime_dir, 'runs', 'legacy-run.json'), '{}');
const incompatibleGraphBytes = fs.statSync(incompatiblePaths.database).size;

const refused = spawnSync(process.execPath, [cli, 'graph', 'observe'], {
  cwd: incompatibleRoot,
  encoding: 'utf8',
  env: { ...process.env, LAMINA_OBSERVATION_BACKEND: 'node' },
});
assert.notEqual(refused.status, 0);
assert.match(refused.stderr, /LAMINA_REPOSITORY_CUTOVER_INCOMPATIBLE|legacy run storage/i);
assert.equal(fs.existsSync(incompatiblePaths.database), true);
assert.equal(fs.statSync(incompatiblePaths.database).size, incompatibleGraphBytes);

const futureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-cutover-future-'));
initFixture(futureRoot);
const futurePaths = runtimePaths(futureRoot);
fs.mkdirSync(futurePaths.runtime_dir, { recursive: true });
fs.writeFileSync(
  runtimeIdentityPath(futureRoot),
  `${JSON.stringify({
    schema: 'lamina.runtime-identity/v1',
    layout_version: SUPPORTED_LAYOUT_VERSION + 1,
    cli_version: CLI_VERSION,
    protocol_version: 9,
    capabilities: [],
  }, null, 2)}\n`,
);
const futureEval = evaluateRepositoryCutover(futureRoot);
assert.equal(futureEval.status, 'incompatible');
assert.match(futureEval.reason, /future_layout_version/);

const derivedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-cutover-derived-'));
initFixture(derivedRoot);
const derivedPaths = runtimePaths(derivedRoot);
fs.mkdirSync(derivedPaths.context, { recursive: true });
fs.mkdirSync(derivedPaths.cocoindex, { recursive: true });
fs.writeFileSync(path.join(derivedPaths.context, 'retrieval.lbdb'), 'derived\n');
fs.writeFileSync(path.join(derivedPaths.cocoindex, 'target-generation'), 'generation\n');
invalidateDerivedStores(derivedPaths);
assert.equal(fs.existsSync(path.join(derivedPaths.context, 'retrieval.lbdb')), false);
assert.equal(fs.existsSync(path.join(derivedPaths.cocoindex, 'target-generation')), false);

async function cleanup() {
  for (const root of [compatibleRoot, incompatibleRoot, futureRoot, derivedRoot]) {
    const paths = runtimePaths(root);
    let pid = null;
    try {
      pid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid;
    } catch {}
    if (pid) await stopIncompatibleServer(paths, pid);
    removeTemporaryTree(root);
  }
}

await cleanup();
console.log('linux_repository_cutover_test: ok');
