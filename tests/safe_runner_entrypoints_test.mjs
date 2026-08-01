#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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
  ['evals/scripts/vendor-plane-fixture.mjs'],
  ['evals/scripts/vendor-outline-fixture.mjs'],
  ['benchmarks/lb6/pilot/scripts/build-runtime.mjs'],
  ['benchmarks/lb6/pilot/scripts/run-three-arm.mjs'],
  ['scripts/build-standalone-cli.mjs'],
  ['scripts/fetch-retrieval-model.mjs'],
  ['scripts/prepare-retrieval-assets.mjs'],
  ['tests/retrieval_native_index_test.mjs'],
  ['tests/cli_binary_smoke_test.mjs'],
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

const cliDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-cli-redaction-'));
const cliReport = path.join(cliDirectory, 'report.json');
try {
  const cli = spawnSync(process.execPath, [
    'scripts/safe-runner/cli.mjs', 'run', '--report', cliReport,
    '--token=cli-nested-secret', '--', process.execPath,
    'tests/fixtures/safe-runner-adversary.mjs', 'success',
  ], { cwd: ROOT, encoding: 'utf8', env: process.env });
  assert.equal(cli.status, 2);
  assert.doesNotMatch(
    `${cli.stdout}\n${cli.stderr}\n${fs.readFileSync(cliReport, 'utf8')}`,
    /cli-nested-secret/,
  );
} finally {
  fs.rmSync(cliDirectory, { recursive: true, force: true });
}

process.stdout.write('safe-runner heavy entrypoint guards passed\n');
