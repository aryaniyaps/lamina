#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { adapterProbe } from '../scripts/safe-runner/adapter.mjs';
import { MIB } from '../scripts/safe-runner/constants.mjs';
import { validateReport } from '../scripts/safe-runner/report.mjs';
import { runSafely } from '../scripts/safe-runner/runner.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-integration-'));
const state = path.join(root, 'state');
const reports = path.join(root, 'reports');
const fixture = path.resolve('tests/fixtures/safe-runner-adversary.mjs');
const graphdFixture = path.resolve('tests/fixtures/safe-runner-graphd-client.mjs');
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = state;
fs.mkdirSync(reports, { recursive: true });

const limits = {
  memoryMaxBytes: 256 * MIB,
  memoryHighBytes: 192 * MIB,
  pidsMax: 8,
  timeoutMs: 1_000,
  outputMaxBytes: MIB,
  tempMaxBytes: MIB,
  sampleIntervalMs: 25,
  sustainedHighSamples: 2,
  gracefulStopMs: 100,
};

try {
  const probe = adapterProbe();
  const common = probe.production_enforcement
    ? { probe }
    : { probe, mode: 'self-test', selfTestCaseId: 'normal_cleanup' };
  const normal = await runSafely({
    ...common,
    command: [process.execPath, fixture, 'success'],
    tier: 'small', cwd: root, reportFile: path.join(reports, 'normal.json'),
    overrides: limits, promote: false,
  });
  assert.equal(normal.outcome, 'success');
  assert.equal(validateReport(normal).valid, true);
  assert.match(normal.output.stdout_tail, /tiny success/);
  assert.ok(normal.peaks.pids >= 1);
  assert.ok(normal.peaks.aggregate_rss_bytes > 0 || !probe.production_enforcement);
  assert.deepEqual(normal.cleanup.descendants_remaining, []);
  assert.equal(normal.cleanup.scope_removed, true);
  assert.equal(normal.cleanup.temporary_directory_removed, true);

  if (probe.production_enforcement) {
    const failure = await runSafely({
      command: [process.execPath, fixture, 'failure'],
      tier: 'small', cwd: root, reportFile: path.join(reports, 'failure.json'),
      overrides: limits, probe, promote: false,
    });
    assert.equal(failure.outcome, 'command_failed');
    assert.equal(failure.termination.child_exit_code, 7);
    assert.equal(validateReport(failure).valid, true);

    const graphRepository = path.join(root, 'graph-repository');
    fs.mkdirSync(graphRepository);
    const initialized = spawnSync('git', ['init', '--quiet'], {
      cwd: graphRepository,
      encoding: 'utf8',
    });
    assert.equal(initialized.status, 0, initialized.stderr);
    const managedGraphd = await runSafely({
      command: [process.execPath, graphdFixture, graphRepository],
      tier: 'small', cwd: root, reportFile: path.join(reports, 'managed-graphd.json'),
      overrides: {
        ...limits,
        pidsMax: 32,
        timeoutMs: 5_000,
        gracefulStopMs: 500,
      },
      probe,
      promote: false,
    });
    assert.equal(managedGraphd.outcome, 'success');
    assert.equal(managedGraphd.preflight.managed_descendant_cleanup.role, 'graphd');
    assert.equal(managedGraphd.preflight.managed_descendant_cleanup.registered_roots.length, 1);
    const graphdOutput = JSON.parse(managedGraphd.output.stdout_tail.trim().split('\n').at(-1));
    const registration = JSON.parse(graphdOutput.registration);
    assert.equal(registration.pid, graphdOutput.pid);
    assert.match(registration.start_ticks, /^\d+$/);
    assert.equal(fs.existsSync(graphdOutput.socket), false, 'graphd socket must be removed');
    assert.equal(fs.existsSync(graphdOutput.lock), false, 'graphd lock must be removed');
    assert.deepEqual(managedGraphd.cleanup.descendants_remaining, []);
    assert.equal(managedGraphd.cleanup.scope_removed, true);
    assert.equal(validateReport(managedGraphd).valid, true);
  }

  const detached = await runSafely({
    command: [process.execPath, fixture, 'detached-child'],
    tier: 'small', cwd: root, reportFile: path.join(reports, 'detached.json'),
    overrides: { ...limits, pidsMax: 32 },
    probe,
    mode: 'self-test',
    selfTestCaseId: 'detached_descendant',
    promote: false,
  });
  assert.equal(detached.outcome, 'safety_limit_exceeded');
  assert.equal(detached.termination.limit, 'detached_descendant');
  assert.ok(detached.peaks.pids >= 2);
  assert.deepEqual(detached.cleanup.descendants_remaining, []);
  assert.equal(detached.cleanup.scope_removed, true);
  assert.equal(detached.cleanup.temporary_directory_removed, true);
  assert.equal(validateReport(detached).valid, true);
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('safe_runner_integration_test: ok');
