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
import { checkPromotion } from '../scripts/safe-runner/state.mjs';

const artifactBase = process.env.LAMINA_SAFE_RUNNER_TEST_ARTIFACT_DIR
  ? path.resolve(process.env.LAMINA_SAFE_RUNNER_TEST_ARTIFACT_DIR)
  : os.tmpdir();
fs.mkdirSync(artifactBase, { recursive: true });
const root = fs.mkdtempSync(path.join(artifactBase, 'lamina-safe-runner-integration-'));
const state = path.join(root, 'state');
const reports = path.join(root, 'reports');
const fixture = path.resolve('tests/fixtures/safe-runner-adversary.mjs');
const graphdFixture = path.resolve('tests/fixtures/safe-runner-graphd-client.mjs');
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = state;
fs.mkdirSync(reports, { recursive: true });
let completed = false;

const limits = {
  memoryMaxBytes: 256 * MIB,
  memoryHighBytes: 192 * MIB,
  pidsMax: 32,
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
  const unwritableParent = path.join(root, 'promotion-report-parent');
  fs.writeFileSync(unwritableParent, 'not a directory');
  const fallbackPromotion = await runSafely({
    ...common,
    command: [process.execPath, fixture, 'success'],
    tier: 'small', cwd: root, reportFile: path.join(unwritableParent, 'result.json'),
    overrides: limits, workloadId: 'fallback-regression', promote: true,
  });
  assert.equal(fallbackPromotion.outcome, 'internal_error');
  assert.equal(fallbackPromotion.writtenReport.fallback, true);
  assert.equal(checkPromotion(root, 'medium', 'fallback-regression').ok, false,
    'fallback reports must never create promotion evidence');
  fs.rmSync(fallbackPromotion.writtenReport.path, { force: true });
  if (probe.production_enforcement) {
    assert.deepEqual(normal.preflight.scope_proof.controller_readback.actual, {
      memory_max_bytes: normal.limits.memory_max_bytes,
      memory_high_bytes: normal.limits.memory_high_bytes,
      pids_max: normal.limits.pids_max,
    });
    assert.ok(normal.samples.every((sample) => Object.hasOwn(sample, 'aggregate_rss_bytes')
      && Object.hasOwn(sample, 'cgroup_memory_bytes')));
  }

  if (probe.production_enforcement) {
    const redacted = await runSafely({
      command: [process.execPath, fixture, 'secret-output', '--token', 'childsecret'],
      tier: 'small', cwd: root, reportFile: path.join(reports, 'redacted.json'),
      overrides: limits, probe, promote: false,
    });
    assert.equal(redacted.outcome, 'success');
    const serializedRedacted = JSON.stringify(redacted);
    assert.doesNotMatch(serializedRedacted, /supersecret|childsecret/);
    assert.match(serializedRedacted, /\[REDACTED\]/);

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

    const graphData = path.join(graphRepository, '.git', 'lamina', 'graph.lbdb');
    fs.writeFileSync(graphData, 'canonical graph data');
    const staleGraphd = await runSafely({
      command: [process.execPath, graphdFixture, graphRepository, 'leave-stale'],
      tier: 'small', cwd: root, reportFile: path.join(reports, 'stale-graphd.json'),
      overrides: { ...limits, timeoutMs: 5_000, gracefulStopMs: 500 },
      probe, promote: false,
    });
    assert.equal(staleGraphd.outcome, 'internal_error');
    assert.equal(staleGraphd.termination.reason, 'cleanup_incomplete');
    assert.equal(staleGraphd.cleanup.managed_paths_remaining.length, 2);
    assert.equal(fs.existsSync(graphData), true, 'cleanup must not delete canonical graph data');
    assert.equal(validateReport(staleGraphd).valid, true);
    for (const managedPath of staleGraphd.cleanup.managed_paths_remaining) {
      fs.rmSync(managedPath, { force: true });
    }

    for (const [mode, expectedLimit] of [
      ['temp-deleted-open', 'temporary_disk'],
      ['temp-inode-storm', 'temporary_inodes'],
      ['temp-symlink', 'temporary_symlink'],
    ]) {
      const temporary = await runSafely({
        command: [process.execPath, fixture, mode],
        tier: 'small', cwd: root, reportFile: path.join(reports, `${mode}.json`),
        overrides: { ...limits, tempMaxBytes: MIB }, probe, promote: false,
      });
      assert.equal(temporary.outcome, 'safety_limit_exceeded', mode);
      assert.equal(temporary.termination.limit, expectedLimit, mode);
      assert.equal(temporary.preflight.temporary_quota_proof.production_enforcement, true);
      assert.deepEqual(temporary.cleanup.descendants_remaining, []);
      assert.equal(validateReport(temporary).valid, true);
    }
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
  if (probe.production_enforcement) {
    assert.equal(detached.outcome, 'safety_limit_exceeded');
    assert.equal(detached.termination.limit, 'detached_descendant');
    assert.ok(detached.peaks.pids >= 2);
    assert.deepEqual(detached.cleanup.descendants_remaining, []);
    assert.equal(detached.cleanup.scope_removed, true);
    assert.equal(detached.cleanup.temporary_directory_removed, true);
  } else {
    assert.equal(detached.outcome, 'preflight_refused');
    assert.equal(detached.preflight.portable_self_test_allowed, false);
    assert.equal(detached.samples.length, 0);
  }
  assert.equal(validateReport(detached).valid, true);
  completed = true;
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  if (completed && !process.env.LAMINA_SAFE_RUNNER_TEST_ARTIFACT_DIR) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  else process.stderr.write(`safe-runner integration evidence preserved at ${root}\n`);
}

console.log('safe_runner_integration_test: ok');
