#!/usr/bin/env node
import assert from 'node:assert/strict';
import { dockerRunWithStdinArgs } from '../benchmarks/scripts/run-phased.mjs';

{
  const args = dockerRunWithStdinArgs(['example-image', 'bash', '-s']);
  assert.deepEqual(args, [
    'run',
    '--rm',
    '-i',
    'example-image',
    'bash',
    '-s',
  ]);
}

console.log('bench_runner_test: ok');
