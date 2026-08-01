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
import { readAttestation } from '../scripts/safe-runner/state.mjs';

const stateSource = fs.readFileSync('scripts/safe-runner/state.mjs', 'utf8');
assert.match(
  stateSource,
  /function fsyncParentDirectory[\s\S]*process\.platform === 'win32'\) return;[\s\S]*fs\.openSync\(path\.dirname\(file\), 'r'\)[\s\S]*fs\.fsyncSync\(parent\)/,
  'Windows may skip only unsupported parent-directory fsync',
);
assert.match(
  stateSource,
  /fs\.constants\.O_CREAT \| fs\.constants\.O_EXCL \| fs\.constants\.O_WRONLY[\s\S]*fs\.writeSync\(descriptor[\s\S]*fs\.fsyncSync\(descriptor\)[\s\S]*fs\.renameSync\(temporary, file\)[\s\S]*fsyncParentDirectory\(file\)/,
  'state publication must write and flush one writable descriptor before atomic rename',
);
assert.doesNotMatch(stateSource, /fs\.openSync\(temporary, 'r'\)/);

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
const previousBwrapPath = process.env.LAMINA_SAFE_BWRAP_PATH;
const previousBwrapSha = process.env.LAMINA_SAFE_BWRAP_SHA256;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'state');
process.env.LAMINA_SAFE_BWRAP_PATH = 'deliberately-relative-portable-poison';
process.env.LAMINA_SAFE_BWRAP_SHA256 = 'not-a-digest';
try {
  const probe = process.platform === 'linux' ? adapterProbe('darwin') : adapterProbe();
  const portableAttestation = readAttestation(probe);
  assert.deepEqual(portableAttestation, {
    valid: false,
    expected_fingerprint: null,
    value: null,
    qualification_available: false,
    qualified_for_production_tiers: false,
    adapter: 'portable-process-group-small-only',
    reason: 'production attestation is unavailable without aggregate production enforcement',
  });
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
  const tinyReasons = tiny.reasons.join('\n');
  assert.doesNotMatch(
    tinyReasons,
    /aggregate enforcement is unavailable|medium\/large execution|adversarial self-test attestation|bwrap|systemd|cgroup/i,
    `portable tiny allowlist added a production/infrastructure refusal: ${JSON.stringify(tiny.reasons)}`,
  );
  assert.deepEqual(tiny.attestation, {
    valid: false, path: 'unavailable', tested_at: null,
    qualified_for_production_tiers: false, qualification_available: false,
    reason: 'production attestation is unavailable without aggregate production enforcement',
  });
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
  const persisted = JSON.parse(fs.readFileSync(path.join(root, 'state', 'self-test.json'), 'utf8'));
  assert.equal(persisted.qualified_for_production_tiers, false);
  assert.equal(persisted.host_fingerprint, null,
    'portable refusal evidence must not compute a Linux infrastructure fingerprint');
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  if (previousBwrapPath === undefined) delete process.env.LAMINA_SAFE_BWRAP_PATH;
  else process.env.LAMINA_SAFE_BWRAP_PATH = previousBwrapPath;
  if (previousBwrapSha === undefined) delete process.env.LAMINA_SAFE_BWRAP_SHA256;
  else process.env.LAMINA_SAFE_BWRAP_SHA256 = previousBwrapSha;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('safe-runner portable contracts passed');
