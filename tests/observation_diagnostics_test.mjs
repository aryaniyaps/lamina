#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { observationCompletionChecks } from '../packages/cli/lib/observe.mjs';
import { runObservationProcess } from '../packages/cli/lib/observation-runtime/cocoindex.mjs';
import { stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
import { parseDaemonLock, runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
import { removeTemporaryTree } from './test-util.mjs';

const expected = { generation: 'generation-current', sourceRevision: 'revision-current' };
const complete = {
  exists: true,
  generation: expected.generation,
  count: 185,
  source_key_count: 185,
  source_revisions: [expected.sourceRevision],
};

const countMismatch = observationCompletionChecks(
  { ...complete, count: 186 },
  expected,
);
assert.deepEqual(countMismatch.failed_checks, ['target.count_matches_source_keys']);

const staleRevision = observationCompletionChecks(
  { ...complete, source_revisions: ['revision-stale'] },
  expected,
);
assert.deepEqual(staleRevision.failed_checks, ['target.current_revision_present']);

const absentGeneration = observationCompletionChecks(
  { ...complete, generation: undefined },
  expected,
);
assert.ok(absentGeneration.failed_checks.includes('status.generation'));
assert.ok(absentGeneration.failed_checks.includes('target.generation_matches'));

const failedWorker = observationCompletionChecks(complete, {
  ...expected,
  workerCompleted: false,
});
assert.deepEqual(failedWorker.failed_checks, ['worker.completed']);

const noisyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-noisy-observer-'));
const noisyMarker = path.join(noisyRoot, 'worker-ran.txt');
const noisyWorker = path.join(noisyRoot, 'noisy-worker.cjs');
fs.writeFileSync(
  noisyWorker,
  `const fs = require('node:fs');
const size = 2 * 1024 * 1024;
fs.writeFileSync(${JSON.stringify(noisyMarker.replace(/\\/g, '/'))}, String(size));
process.stdout.write('x'.repeat(size));
`,
);
try {
  const noisyResult = runObservationProcess({
    command: process.execPath,
    args: [noisyWorker],
    cwd: noisyRoot,
    environment: process.env,
  });
  assert.equal(noisyResult.status, 0);
  assert.equal(fs.readFileSync(noisyMarker, 'utf8'), String(2 * 1024 * 1024));
  assert.equal(noisyResult.stdout.length, 4_000);
  assert.match(noisyResult.stdout, /^x+$/);
} finally {
  removeTemporaryTree(noisyRoot);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-observation-diagnostics-'));
const cli = path.resolve('packages/cli/bin/lamina.mjs');
let daemonPid = null;
try {
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  fs.writeFileSync(path.join(root, 'README.md'), '# worker failure\n');
  const result = spawnSync(process.execPath, [cli, 'graph', 'observe'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      LAMINA_OBSERVATION_BACKEND: 'node',
      LAMINA_TEST_OBSERVATION_CRASH_AFTER_COMMIT: '1',
    },
    timeout: 60_000,
  });
  assert.equal(result.status, 1, result.stdout);
  const failure = JSON.parse(result.stderr);
  assert.equal(failure.error.code, 'LAMINA_OBSERVATION_INCOMPLETE');
  assert.deepEqual(failure.error.details.failed_checks, ['worker.completed']);
  assert.equal(failure.error.details.worker_diagnostics.length, 2);
  assert.ok(failure.error.details.worker_diagnostics.every((item) => item.ok === false));
  assert.equal(failure.error.details.daemon.protocol_version, 9);
  daemonPid = parseDaemonLock(fs.readFileSync(runtimePaths(root).lock, 'utf8'))?.pid;
} finally {
  if (daemonPid) {
    try { await stopIncompatibleServer(runtimePaths(root), daemonPid); } catch {}
  }
  removeTemporaryTree(root);
}

console.log('observation_diagnostics_test: ok');
