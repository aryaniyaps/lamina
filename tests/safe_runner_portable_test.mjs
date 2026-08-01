#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adapterProbe, assertAdapterShape } from '../scripts/safe-runner/adapter.mjs';
import { MIB, SELF_TEST_CASE_IDS } from '../scripts/safe-runner/constants.mjs';
import { PortableProcessGroupAdapter } from '../scripts/safe-runner/portable-process-group.mjs';
import { preflightRun } from '../scripts/safe-runner/preflight.mjs';
import { runAdversarialSelfTests } from '../scripts/safe-runner/self-test.mjs';

for (const platform of ['darwin', 'win32']) {
  const probe = adapterProbe(platform);
  assert.equal(probe.id, 'portable-process-group-small-only');
  assert.equal(probe.production_enforcement, false);
  assert.equal(probe.aggregate_memory, false);
  assert.equal(probe.aggregate_pids, false);
  assert.equal(probe.complete_descendant_ownership, false);
}
assert.equal(assertAdapterShape(new PortableProcessGroupAdapter()).id,
  'portable-process-group-small-only');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-portable-contract-'));
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'state');
try {
  const probe = process.platform === 'linux' ? adapterProbe('darwin') : adapterProbe();
  const fixture = path.resolve('tests/fixtures/safe-runner-adversary.mjs');
  const base = {
    memoryMaxBytes: 192 * MIB,
    memoryHighBytes: 160 * MIB,
    timeoutMs: 2_000,
    outputMaxBytes: 256 * 1024,
    tempMaxBytes: 4 * MIB,
    sampleIntervalMs: 25,
    sustainedHighSamples: 2,
    gracefulStopMs: 100,
  };
  const classify = (pidsMax) => preflightRun({
    tier: 'small', command: [process.execPath, fixture, 'success'], cwd: process.cwd(),
    overrides: { ...base, pidsMax }, adapterInfo: probe, mode: 'self-test',
    selfTestCaseId: 'normal_cleanup', injectedExistingProcesses: [],
  });
  const tiny = classify(32);
  assert.equal(tiny.deliberately_tiny_self_test, true);
  assert.equal(tiny.portable_self_test_allowed, true);
  assert.equal(tiny.ok, true);
  const oversized = classify(64);
  assert.equal(oversized.deliberately_tiny_self_test, false);
  assert.equal(oversized.portable_self_test_allowed, false);
  assert.match(oversized.reasons.join('\n'), /aggregate enforcement is unavailable/);

  const medium = preflightRun({
    tier: 'medium', command: [process.execPath, fixture, 'success'], cwd: process.cwd(),
    overrides: { ...base, pidsMax: 32 }, adapterInfo: probe,
    injectedExistingProcesses: [], workloadId: 'portable-refusal-contract',
  });
  assert.equal(medium.ok, false);
  assert.match(medium.reasons.join('\n'), /medium\/large execution requires Linux/);

  const qualification = await runAdversarialSelfTests({ cwd: process.cwd(), probe });
  assert.equal(qualification.passed, false);
  assert.equal(qualification.qualified_for_production_tiers, false);
  assert.equal(qualification.cases.length, SELF_TEST_CASE_IDS.length);
  assert.ok(qualification.cases.every((item) => item.skipped === true));
  assert.match(qualification.refusal.message, /requires Linux user-systemd cgroup-v2/);
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('safe-runner portable contracts passed');
