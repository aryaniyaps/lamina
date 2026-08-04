#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { brownfieldSignals } from '../packages/cli/lib/observation-runtime/node.mjs';
import {
  activateGenerationPlan,
  commitGenerationState,
  emptyGenerationState,
  generationStatePath,
  interruptedRecoveryNeeded,
  observationFreshnessContext,
  observationMembershipDigest,
  planObservationSync,
  readGenerationState,
} from '../packages/cli/lib/observation-generation.mjs';
import { removeTemporaryTree } from './test-util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-observation-generation-'));
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const statePath = generationStatePath(path.join(root, '.git', 'lamina', 'cocoindex'));

try {
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@lamina.invalid']);
  git(['config', 'user.name', 'Lamina Test']);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'alpha.ts'), 'export const alpha = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'beta.ts'), 'export const beta = 2;\n');
  git(['add', 'src']);
  git(['commit', '-m', 'fixture']);

  const freshness = observationFreshnessContext(root);
  assert.equal(freshness.non_canonical, true);
  assert.equal(freshness.writes_product_truth, false);
  assert.equal(freshness.branch, 'main');
  assert.equal(freshness.worktree, fs.realpathSync.native(root));

  const snapshot = {
    product: path.basename(path.dirname(path.join(root, '.git'))),
    source_revision: freshness.source_revision,
    source_root: root,
    ignore_policy_digest: 'ignore-test',
    extractor_set_digest: 'extractor-test',
  };

  const committedFreshness = observationFreshnessContext(root);
  const initial = planObservationSync({
    repositoryRoot: root,
    generation: 'generation-a',
    snapshot,
    freshness: committedFreshness,
    previous: emptyGenerationState(),
    extractSignals: brownfieldSignals,
  });
  assert.equal(initial.expected_count, 2);
  assert.equal(initial.envelopes.length, 2);
  assert.equal(initial.deletes.length, 0);
  assert.equal(initial.membership_digest, observationMembershipDigest(initial.records));
  activateGenerationPlan(initial);

  const previousCommitted = {
    ...emptyGenerationState(),
    generation: 'generation-a',
    ...committedFreshness,
    records: initial.records,
    membership_digest: initial.membership_digest,
    commit_phase: 'committed',
  };

  fs.writeFileSync(path.join(root, 'src', 'beta.ts'), 'export const beta = 3;\n');
  git(['add', 'src/beta.ts']);
  git(['commit', '-m', 'change beta']);
  const changedFreshness = observationFreshnessContext(root);
  const changed = planObservationSync({
    repositoryRoot: root,
    generation: 'generation-a',
    snapshot: { ...snapshot, source_revision: changedFreshness.source_revision },
    freshness: changedFreshness,
    previous: previousCommitted,
    extractSignals: brownfieldSignals,
  });
  assert.equal(changed.envelopes.length, 2);
  assert.equal(changed.deletes.length, 0);
  assert.notEqual(changed.membership_digest, initial.membership_digest);

  const unchanged = planObservationSync({
    repositoryRoot: root,
    generation: 'generation-a',
    snapshot: { ...snapshot, source_revision: changedFreshness.source_revision },
    freshness: changedFreshness,
    previous: {
      ...previousCommitted,
      records: changed.records,
      membership_digest: changed.membership_digest,
      source_revision: changedFreshness.source_revision,
      repository_revision: changedFreshness.repository_revision,
    },
    extractSignals: brownfieldSignals,
  });
  assert.equal(unchanged.envelopes.length, 0);
  assert.equal(unchanged.deletes.length, 0);

  git(['mv', 'src/alpha.ts', 'src/gamma.ts']);
  git(['commit', '-m', 'rename alpha']);
  const renamed = planObservationSync({
    repositoryRoot: root,
    generation: 'generation-a',
    snapshot,
    freshness: observationFreshnessContext(root),
    previous: {
      ...previousCommitted,
      records: changed.records,
      membership_digest: changed.membership_digest,
      source_revision: changedFreshness.source_revision,
      repository_revision: changedFreshness.repository_revision,
    },
    extractSignals: brownfieldSignals,
  });
  assert.equal(renamed.deletes.length, 1);
  assert.ok(renamed.tombstones['src/alpha.ts']);
  assert.ok(renamed.records['src/gamma.ts']);

  git(['rm', 'src/beta.ts']);
  git(['commit', '-m', 'delete beta']);
  const deleted = planObservationSync({
    repositoryRoot: root,
    generation: 'generation-a',
    snapshot,
    freshness: observationFreshnessContext(root),
    previous: {
      ...previousCommitted,
      generation: 'generation-a',
      records: renamed.records,
      tombstones: renamed.tombstones,
      source_revision: observationFreshnessContext(root).source_revision,
      repository_revision: observationFreshnessContext(root).repository_revision,
    },
    extractSignals: brownfieldSignals,
  });
  assert.equal(deleted.deletes.length, 1);
  assert.ok(deleted.tombstones['src/beta.ts']);

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  commitGenerationState(statePath, deleted, { phase: 'pending' });
  const pending = readGenerationState(statePath);
  assert.equal(pending.commit_phase, 'pending');
  assert.equal(interruptedRecoveryNeeded(pending, { generation: 'generation-a', freshness: observationFreshnessContext(root) }), true);

  const recovered = planObservationSync({
    repositoryRoot: root,
    generation: 'generation-a',
    snapshot,
    freshness: observationFreshnessContext(root),
    previous: pending,
    extractSignals: brownfieldSignals,
  });
  assert.equal(recovered.interrupted_recovery, true);
  assert.ok(recovered.envelopes.length >= 1);
  commitGenerationState(statePath, recovered, { phase: 'committed' });
  assert.equal(readGenerationState(statePath).commit_phase, 'committed');
} finally {
  removeTemporaryTree(root);
}

console.log('observation_generation_test: ok');
