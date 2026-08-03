#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REVIEWED_INVENTORIES } from '../benchmarks/real-repository-oracle-v1/collection-authority.mjs';
import { loadManifest } from '../benchmarks/runtime-baseline-v1/contract.mjs';
import { brownfieldSignals } from '../packages/cli/lib/observation-runtime/node.mjs';
import {
  BASELINE_EXCLUSION_RULES,
  OBSERVATION_COVERAGE_CATEGORIES,
  OBSERVATION_IGNORE_PATTERNS,
  buildCoverageFoundation,
  classifyExclusion,
  enumerateGitInventoryPaths,
  enumerateObservationPaths,
  inventoryPathsDigest,
  observationInventorySnapshot,
  sourcePathIdentity,
  summarizePathInventory,
} from '../packages/cli/lib/source-inventory.mjs';
import { removeTemporaryTree } from './test-util.mjs';

const { manifest } = loadManifest();
assert.deepEqual(BASELINE_EXCLUSION_RULES, manifest.exclusions);
assert.equal(OBSERVATION_IGNORE_PATTERNS.length, 17);
assert.equal(OBSERVATION_COVERAGE_CATEGORIES.length, 14);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-source-inventory-'));
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
try {
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@lamina.invalid']);
  git(['config', 'user.name', 'Lamina Test']);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const FEATURE_FLAG = true;\n');
  fs.writeFileSync(path.join(root, 'src', 'routes.ts'), "app.get('/health', handler);\n");
  fs.writeFileSync(path.join(root, 'README.md'), '# docs\n');
  fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'module.exports = {};\n');
  fs.mkdirSync(path.join(root, '.lamina', 'runs', 'legacy'), { recursive: true });
  fs.writeFileSync(path.join(root, '.lamina', 'business-context.md'), '# ctx\n');
  fs.writeFileSync(path.join(root, '.lamina', 'runs', 'legacy', 'run.json'), '{"legacy":true}\n');
  fs.writeFileSync(path.join(root, 'scratch.ts'), 'export const scratch = 1;\n');
  git(['add', 'src', 'README.md', '.lamina/business-context.md']);
  git(['commit', '-m', 'fixture']);

  const trackedOnly = enumerateGitInventoryPaths(root, { includeUntracked: false });
  assert.deepEqual(trackedOnly, ['.lamina/business-context.md', 'README.md', 'src/index.ts', 'src/routes.ts']);

  const withUntracked = enumerateGitInventoryPaths(root);
  assert.ok(withUntracked.includes('scratch.ts'));
  assert.ok(!enumerateObservationPaths(root).some((item) => item.path.startsWith('node_modules/')));

  assert.equal(classifyExclusion('node_modules/dep/index.js', manifest.exclusions), 'dependency_root');
  assert.equal(classifyExclusion('.lamina/runs/legacy/run.json', manifest.exclusions), 'lamina_run_artifacts');
  assert.equal(classifyExclusion('src/index.ts', manifest.exclusions), null);

  const observed = enumerateObservationPaths(root);
  assert.deepEqual(observed.map((item) => item.path), ['.lamina/business-context.md', 'README.md', 'scratch.ts', 'src/index.ts', 'src/routes.ts']);

  const identity = sourcePathIdentity('src/index.ts', Buffer.from('export const FEATURE_FLAG = true;\n'));
  assert.equal(identity.source_key, 'src/index.ts');
  assert.equal(identity.content_sha256, crypto.createHash('sha256').update('export const FEATURE_FLAG = true;\n').digest('hex'));
  assert.equal(identity.identity_digest.length, 64);

  const summary = summarizePathInventory(withUntracked, root, manifest, null);
  assert.equal(summary.inventory.tracked_files, withUntracked.length);
  assert.equal(summary.inventory.observation_indexed_files, observed.length);
  assert.equal(summary.inventory.observation_paths_digest, inventoryPathsDigest(observed.map((item) => item.path)));
  assert.equal(summary.non_canonical, true);
  assert.equal(summary.writes_product_truth, false);

  const coverage = buildCoverageFoundation(summary.entries, {
    repository: root,
    extractSignals: brownfieldSignals,
  });
  assert.ok(coverage.categories.routes.length >= 1);
  assert.ok(coverage.categories.documentation.length >= 1);
  assert.equal(coverage.non_canonical, true);
  assert.equal(coverage.writes_product_truth, false);

  const snapshot = observationInventorySnapshot(root, { extractSignals: brownfieldSignals });
  assert.equal(snapshot.schema, 'lamina.source-inventory/v1');
  assert.equal(snapshot.non_canonical, true);
  assert.equal(snapshot.writes_product_truth, false);
  assert.deepEqual(snapshot.exclusion_rules, manifest.exclusions);
  assert.equal(snapshot.inventory.observation_indexed_files, observed.length);
} finally {
  removeTemporaryTree(root);
}

assert.equal(
  REVIEWED_INVENTORIES.small.observation_paths_digest,
  'a751c5ae498aad42ec231daf714f8bede3e76f1d6f083ccbe3b6097f666b07cc',
  'reviewed small fixture observation digest remains frozen',
);

console.log('source_inventory_test: ok');
