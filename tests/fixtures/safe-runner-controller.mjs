#!/usr/bin/env node
import path from 'node:path';
import { runSafely } from '../../scripts/safe-runner/runner.mjs';
import { MIB } from '../../scripts/safe-runner/constants.mjs';

const [cwd, reportFile, boundary = 'payload_released', graphRepository = null] = process.argv.slice(2);
if (!cwd || !reportFile) process.exit(64);
const graphd = [
  'graphd_reserved', 'graphd_spawned', 'graphd_bound', 'graphd_authorized',
  'graphd_lock_created', 'graphd_objects_ready', 'graphd_sealed',
]
  .includes(boundary);
const fixtureMode = boundary === 'after_limit_observed' ? 'output-flood'
  : boundary === 'success_report_published' ? 'success' : 'hang';
const fixtureArguments = boundary === 'after_limit_observed'
  ? [fixtureMode, 'crash-after-limit'] : [fixtureMode];
await runSafely({
  command: graphd ? [process.execPath,
    path.resolve('tests/fixtures/safe-runner-graphd-client.mjs'), graphRepository]
    : [process.execPath, path.resolve('tests/fixtures/safe-runner-adversary.mjs'), ...fixtureArguments],
  tier: 'small',
  cwd,
  reportFile,
  overrides: {
    memoryMaxBytes: 192 * MIB,
    memoryHighBytes: 160 * MIB,
    pidsMax: graphd ? 64 : 32,
    timeoutMs: 5_000,
    outputMaxBytes: 64 * 1024,
    tempMaxBytes: MIB,
    sampleIntervalMs: 25,
    sustainedHighSamples: 2,
    gracefulStopMs: 75,
  },
  mode: ['payload_released', 'success_report_published'].includes(boundary) ? 'self-test' : 'run',
  selfTestCaseId: ['payload_released', 'success_report_published'].includes(boundary)
    ? 'parent_signal' : null,
  promote: false,
  _testCrashBoundary: boundary,
  _testCrashMarkerFile: `${reportFile}.crash-boundary`,
});
