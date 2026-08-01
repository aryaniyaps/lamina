#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const entrypoints = [
  ['benchmarks/retrieval-v1/benchmark.mjs', '--evaluate'],
  ['evals/scripts/run-suite.mjs'],
  ['evals/scripts/run-reference-matrix.mjs'],
  ['evals/scripts/loop-next-batch.mjs'],
  ['evals/scripts/vendor-nextjs-fixture.mjs'],
  ['evals/scripts/vendor-payload-fixture.mjs'],
  ['benchmarks/lb6/pilot/scripts/build-runtime.mjs'],
  ['benchmarks/lb6/pilot/scripts/run-three-arm.mjs'],
];

for (const [entrypoint, ...args] of entrypoints) {
  const result = spawnSync(process.execPath, [path.join(ROOT, entrypoint), ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      LAMINA_SAFE_RUNNER_CONTEXT: '',
      LAMINA_SAFE_RUNNER_TOKEN: '',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  });
  assert.notEqual(result.status, 0, `${entrypoint} must refuse a direct launch`);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /must run through the canonical crash-safe command/,
    `${entrypoint} must explain the canonical command`,
  );
}

process.stdout.write('safe-runner heavy entrypoint guards passed\n');
