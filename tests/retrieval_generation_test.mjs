#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadManifest } from '../benchmarks/runtime-baseline-v1/contract.mjs';
import { RETRIEVAL_SCHEMA_VERSION } from '../packages/cli/lib/retrieval-runtime/constants.mjs';
import {
  activateGenerationPlan,
  commitGenerationState,
  emptyGenerationState,
  freshnessChanged,
  generationStatePath,
  interruptedRecoveryNeeded,
  planRetrievalSync,
  readGenerationState,
  retrievalFreshnessContext,
  retrievalGenerationId,
  retrievalMembershipDigest,
} from '../packages/cli/lib/retrieval-generation.mjs';
import {
  enumerateRetrievalCandidatePaths,
  inventoryPathsDigest,
} from '../packages/cli/lib/source-inventory.mjs';
import { removeTemporaryTree } from './test-util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-retrieval-generation-'));
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const statePath = generationStatePath(path.join(root, '.git', 'lamina', 'context'));

try {
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@lamina.invalid']);
  git(['config', 'user.name', 'Lamina Test']);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'alpha.ts'), 'export const alpha = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'beta.ts'), 'export const beta = 2;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# docs\n');
  fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'module.exports = {};\n');
  git(['add', 'src', 'README.md']);
  git(['commit', '-m', 'fixture']);

  const freshness = retrievalFreshnessContext(root, {
    graph_version: 'graph-v1',
    model_digest: 'model-v1',
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    observation_generation: 'observation-gen-a',
    observation_membership_digest: 'a'.repeat(64),
  });
  assert.equal(freshness.non_canonical, true);
  assert.equal(freshness.writes_product_truth, false);
  assert.equal(freshness.schema_version, RETRIEVAL_SCHEMA_VERSION);

  const identity = 'retrieval_test_identity';
  const generationA = retrievalGenerationId({ identity, ...freshness });
  const candidates = enumerateRetrievalCandidatePaths(root);
  assert.deepEqual(candidates, ['README.md', 'src/alpha.ts', 'src/beta.ts']);
  assert.equal(
    inventoryPathsDigest(candidates),
    inventoryPathsDigest(enumerateRetrievalCandidatePaths(root)),
  );

  const initial = planRetrievalSync({
    repositoryRoot: root,
    identity,
    freshness,
    previous: emptyGenerationState(),
  });
  assert.equal(initial.generation, generationA);
  assert.equal(initial.source_paths.length, 3);
  assert.equal(initial.full_reconcile, true);
  assert.equal(initial.interrupted_recovery, false);

  const committed = commitGenerationState(statePath, initial, {
    index_digest: 'b'.repeat(64),
    expected_count: 4,
    committed_count: 4,
  });
  assert.equal(committed.commit_phase, 'committed');
  assert.equal(readGenerationState(statePath).generation, generationA);

  const pendingFreshness = retrievalFreshnessContext(root, {
    ...freshness,
    observation_membership_digest: 'c'.repeat(64),
  });
  const pending = {
    ...initial,
    freshness: pendingFreshness,
    generation: retrievalGenerationId({ identity, ...pendingFreshness }),
  };
  commitGenerationState(statePath, pending, null, { phase: 'pending' });
  const storedPending = readGenerationState(statePath);
  assert.equal(
    interruptedRecoveryNeeded(storedPending, {
      generation: storedPending.generation,
      freshness: pendingFreshness,
    }),
    true,
  );
  assert.equal(freshnessChanged(storedPending, freshness), true);

  activateGenerationPlan(initial, {
    index_digest: 'b'.repeat(64),
    expected_count: 4,
    committed_count: 4,
  });
  assert.throws(
    () => activateGenerationPlan({ ...initial, index_digest: 'b'.repeat(64) }, {
      index_digest: 'd'.repeat(64),
      expected_count: 4,
      committed_count: 4,
    }),
    /index digest is invalid/,
  );

  const { manifest } = loadManifest();
  assert.ok(manifest.retrieval_extensions.includes('.ts'));
} finally {
  removeTemporaryTree(root);
}

console.log('retrieval_generation_test: ok');
