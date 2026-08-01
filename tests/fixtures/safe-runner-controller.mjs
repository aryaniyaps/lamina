#!/usr/bin/env node
import path from 'node:path';
import { runSafely } from '../../scripts/safe-runner/runner.mjs';
import { MIB } from '../../scripts/safe-runner/constants.mjs';

const [cwd, reportFile] = process.argv.slice(2);
if (!cwd || !reportFile) process.exit(64);
await runSafely({
  command: [
    process.execPath,
    path.resolve('tests/fixtures/safe-runner-adversary.mjs'),
    'hang',
  ],
  tier: 'small',
  cwd,
  reportFile,
  overrides: {
    memoryMaxBytes: 192 * MIB,
    memoryHighBytes: 160 * MIB,
    pidsMax: 32,
    timeoutMs: 5_000,
    outputMaxBytes: 64 * 1024,
    tempMaxBytes: MIB,
    sampleIntervalMs: 25,
    sustainedHighSamples: 2,
    gracefulStopMs: 75,
  },
  mode: 'self-test',
  selfTestCaseId: 'parent_signal',
  promote: false,
});
