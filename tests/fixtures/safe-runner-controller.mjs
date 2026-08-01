#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIB } from '../../scripts/safe-runner/constants.mjs';
import { runSafely } from '../../scripts/safe-runner/runner.mjs';

const [reportFile, marker, cwd] = process.argv.slice(2);
const fixture = fileURLToPath(new URL('./safe-runner-adversary.mjs', import.meta.url));
await runSafely({
  command: [process.execPath, fixture, 'crash-marker-hang', path.resolve(marker)],
  tier: 'small',
  cwd: path.resolve(cwd),
  reportFile: path.resolve(reportFile),
  overrides: {
    memoryMaxBytes: 256 * MIB,
    memoryHighBytes: 192 * MIB,
    pidsMax: 32,
    timeoutMs: 5_000,
    outputMaxBytes: MIB,
    tempMaxBytes: MIB,
    sampleIntervalMs: 25,
    gracefulStopMs: 100,
  },
});
