#!/usr/bin/env node
import path from 'node:path';
import { runSafely } from '../../scripts/safe-runner/runner.mjs';
import { MIB } from '../../scripts/safe-runner/constants.mjs';

const [cwd, reportFile, graphRepository, phaseFile] = process.argv.slice(2);
await runSafely({
  command: [
    process.execPath, path.resolve('tests/fixtures/safe-runner-graphd-client.mjs'),
    graphRepository, 'leave-stale', 'hold',
  ],
  tier: 'small', cwd, reportFile, promote: false,
  overrides: {
    memoryMaxBytes: 256 * MIB, memoryHighBytes: 192 * MIB, pidsMax: 64,
    timeoutMs: 300, outputMaxBytes: MIB, tempMaxBytes: MIB,
    sampleIntervalMs: 25, sustainedHighSamples: 2, gracefulStopMs: 100,
  },
  _testPhaseFile: phaseFile,
});
