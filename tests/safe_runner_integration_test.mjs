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
import { runSupervisorCrashSelfTest } from '../scripts/safe-runner/self-test.mjs';
import { checkPromotion, checkSafetyRetry } from '../scripts/safe-runner/state.mjs';
import { runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';

const artifactBase = process.env.LAMINA_SAFE_RUNNER_TEST_ARTIFACT_DIR
  ? path.resolve(process.env.LAMINA_SAFE_RUNNER_TEST_ARTIFACT_DIR)
  : os.tmpdir();
fs.mkdirSync(artifactBase, { recursive: true });
const root = fs.mkdtempSync(path.join(artifactBase, 'lamina-safe-runner-integration-'));
const state = path.join(root, 'state');
const reports = path.join(root, 'reports');
const fixture = path.resolve('tests/fixtures/safe-runner-adversary.mjs');
const graphdFixture = path.resolve('tests/fixtures/safe-runner-graphd-client.mjs');
const mutableFixture = path.resolve('tests/fixtures/safe-runner-mutable.mjs');
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
const workloadCwd = process.cwd();
const workspaceScratchRoot = runtimePaths(workloadCwd).work;
fs.mkdirSync(workspaceScratchRoot, { recursive: true, mode: 0o700 });
const workspaceScratch = fs.mkdtempSync(path.join(workspaceScratchRoot, 'safe-runner-integration-'));
const cleanupWorkspaceScratch = () => {
  try { fs.rmSync(workspaceScratch, { recursive: true, force: true }); } catch {}
};
process.once('exit', cleanupWorkspaceScratch);
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
  let injectedLaunches = 0;
  const injectedAdapter = {
    id: 'caller-injected-portable',
    launch() { injectedLaunches += 1; throw new Error('must not launch'); },
    sample() { return { pids: [], records: [] }; },
    signal() {},
    cleanup() { return { pids: [], removed: true, errors: [] }; },
  };
  for (const tier of ['medium', 'large']) {
    const injected = await runSafely({
      command: [process.execPath, fixture, 'success'],
      tier,
      cwd: workloadCwd,
      reportFile: path.join(reports, `injected-${tier}.json`),
      adapter: injectedAdapter,
      probe: { ...probe, id: 'caller-forged-production', production_enforcement: true },
    });
    assert.equal(injected.outcome, 'preflight_refused');
    assert.equal(injected.adapter.id, probe.id);
  }
  assert.equal(injectedLaunches, 0, 'public calls must not inject an enforcement adapter');
  const common = probe.production_enforcement
    ? { probe }
    : { probe, mode: 'self-test', selfTestCaseId: 'normal_cleanup' };
  const normal = await runSafely({
    ...common,
    command: [process.execPath, fixture, 'success'],
    tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, 'normal.json'),
    // Workload runtime starts immediately before final FIFO release, so this
    // success control allows for sandbox and Node startup after release.
    // Explicit hang and limit cases retain the one-second runtime clock.
    overrides: { ...limits, timeoutMs: 5_000 }, promote: false,
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
    tier: 'small', cwd: workloadCwd, reportFile: path.join(unwritableParent, 'result.json'),
    overrides: limits, workloadId: 'fallback-regression', promote: true,
  });
  assert.equal(fallbackPromotion.outcome, 'internal_error');
  assert.equal(fallbackPromotion.writtenReport.fallback, true);
  assert.equal(checkPromotion(workloadCwd, 'medium', 'fallback-regression').ok, false,
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
    const supervisorCrash = await runSupervisorCrashSelfTest({ cwd: process.cwd(), reportDirectory: reports });
    assert.equal(supervisorCrash.passed, true, JSON.stringify(supervisorCrash, null, 2));
    assert.ok(Object.values(supervisorCrash.evidence).every(Boolean));
    assert.equal(validateReport(supervisorCrash.report).valid, true);
    const beforeReleaseCrash = await runSupervisorCrashSelfTest({
      cwd: process.cwd(), reportDirectory: reports, boundary: 'before_payload_release',
    });
    assert.equal(beforeReleaseCrash.passed, true, JSON.stringify(beforeReleaseCrash, null, 2));
    assert.equal(beforeReleaseCrash.report.outcome, 'internal_error');
    assert.equal(beforeReleaseCrash.report.termination.reason, 'supervisor_crash_before_payload');
    assert.ok(beforeReleaseCrash.report.samples.length > 0,
      'pre-release crash evidence must retain scope samples while remaining unarmed');
    const preparationCrash = await runSupervisorCrashSelfTest({
      cwd: process.cwd(), reportDirectory: reports, boundary: 'report_slot_acquired',
      previousReport: normal,
    });
    assert.equal(preparationCrash.passed, true, JSON.stringify(preparationCrash, null, 2));
    assert.notEqual(preparationCrash.report.run_id, normal.run_id,
      'preparation crash must never expose the previous successful run');
    for (const boundary of ['watchdog_state_created', 'runner_temporary_created']) {
      const bootstrapCrash = await runSupervisorCrashSelfTest({
        cwd: process.cwd(), reportDirectory: reports, boundary,
      });
      assert.equal(bootstrapCrash.passed, true, JSON.stringify(bootstrapCrash, null, 2));
      assert.equal(bootstrapCrash.evidence.temporary_removed, true);
      assert.equal(bootstrapCrash.evidence.watchdog_state_removed, true);
      assert.equal(bootstrapCrash.evidence.lock_removed, true);
      assert.equal(bootstrapCrash.evidence.subsequent_claim, true);
      assert.equal(bootstrapCrash.evidence.descendants_absent, true);
      assert.equal(bootstrapCrash.evidence.scope_absent, true);
      assert.equal(validateReport(bootstrapCrash.report).valid, true);
    }
    const snapshotCrash = await runSupervisorCrashSelfTest({
      cwd: process.cwd(), reportDirectory: reports, boundary: 'snapshot_building',
    });
    assert.equal(snapshotCrash.passed, true, JSON.stringify(snapshotCrash, null, 2));
    assert.equal(snapshotCrash.evidence.temporary_removed, true,
      'watchdog must remove partial execution authority after controller loss');
    const successPublicationCrash = await runSupervisorCrashSelfTest({
      cwd: process.cwd(), reportDirectory: reports, boundary: 'success_report_published',
    });
    assert.equal(successPublicationCrash.passed, true, JSON.stringify(successPublicationCrash, null, 2));
    assert.notEqual(successPublicationCrash.report.outcome, 'success',
      'watchdog must invalidate a success published immediately before controller death');

    const afterLimitCrash = await runSupervisorCrashSelfTest({
      cwd: process.cwd(), reportDirectory: reports, boundary: 'after_limit_observed',
    });
    assert.equal(afterLimitCrash.passed, true, JSON.stringify(afterLimitCrash, null, 2));
    const afterLimitCommand = [process.execPath, fixture, 'output-flood', 'crash-after-limit'];
    assert.equal(checkSafetyRetry(workloadCwd, afterLimitCommand, limits).ok, false,
      'SIGKILL after limit observation must retain the frozen active-attempt retry fence');
  }

  if (probe.production_enforcement) {
    const redacted = await runSafely({
      command: [process.execPath, fixture, 'secret-output', '--token', 'childsecret'],
      tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, 'redacted.json'),
      overrides: limits, probe, promote: false,
    });
    assert.equal(redacted.outcome, 'success');
    const serializedRedacted = JSON.stringify(redacted);
    assert.doesNotMatch(serializedRedacted, /supersecret|childsecret/);
    assert.match(serializedRedacted, /\[REDACTED\]/);

    const poisonedEnvironment = await runSafely({
      command: [process.execPath, fixture, 'environment-poison'],
      tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, 'environment-poison.json'),
      overrides: limits, probe, promote: false,
      env: {
        PATH: path.join(root, 'attacker-bin'), LD_PRELOAD: '/tmp/attacker.so',
        LD_AUDIT: '/tmp/audit.so', NODE_OPTIONS: '--require=/tmp/attacker.cjs',
        NODE_PATH: '/tmp/node-path', BASH_ENV: '/tmp/bash-env',
        'BASH_FUNC_payload%%': `() { touch ${path.join(root, 'bash-function-ran')}; }`,
        LD_DEBUG_OUTPUT: path.join(root, 'ld-debug'),
        NODE_V8_COVERAGE: path.join(root, 'v8-coverage'),
        NODE_COMPILE_CACHE: path.join(root, 'node-cache'),
        NODE_REDIRECT_WARNINGS: path.join(root, 'node-warnings'),
      },
    });
    assert.equal(poisonedEnvironment.outcome, 'success');
    const environmentEvidence = JSON.parse(poisonedEnvironment.output.stdout_tail.trim().split('\n').at(-1));
    assert.notEqual(environmentEvidence.path, path.join(root, 'attacker-bin'));
    for (const name of [
      'ld_preload', 'ld_audit', 'node_options', 'node_path', 'bash_env',
      'bash_function', 'ld_debug_output', 'node_v8_coverage', 'node_compile_cache',
      'node_redirect_warnings',
    ]) {
      assert.equal(environmentEvidence[name], null, `${name} must be stripped from reusable API overrides`);
    }
    for (const candidate of [
      'bash-function-ran', 'ld-debug', 'v8-coverage', 'node-cache', 'node-warnings',
    ]) assert.equal(fs.existsSync(path.join(root, candidate)), false,
    `${candidate} must not be executed or written by host-side launch stages`);

    const mutableOriginal = fs.readFileSync(mutableFixture, 'utf8');
    const mutableMarker = path.join(workspaceScratch, 'mutated-payload-executed');
    let finalIdentityMutation;
    try {
      finalIdentityMutation = await runSafely({
        command: [process.execPath, mutableFixture, mutableMarker],
        tier: 'small', cwd: workloadCwd,
        reportFile: path.join(reports, 'final-identity-mutation.json'),
        overrides: limits, probe, promote: false,
        _testBeforeQuotaRelease() {
          fs.appendFileSync(mutableFixture, '\n// deterministic quota-handshake mutation\n');
        },
      });
    } finally {
      fs.writeFileSync(mutableFixture, mutableOriginal);
    }
    assert.equal(finalIdentityMutation.outcome, 'internal_error');
    assert.equal(finalIdentityMutation.error.code, 'LAMINA_SAFE_SOURCE_IDENTITY_CHANGED');
    assert.equal(fs.existsSync(mutableMarker), false,
      'payload must remain behind the quota gate after final identity mutation');
    assert.deepEqual(finalIdentityMutation.cleanup.descendants_remaining, []);

    const sealedMarker = path.join(workspaceScratch, 'sealed-payload-executed');
    let sealedExecution;
    try {
      sealedExecution = await runSafely({
        command: [process.execPath, mutableFixture, sealedMarker],
        tier: 'small', cwd: workloadCwd,
        reportFile: path.join(reports, 'sealed-execution.json'),
        overrides: limits, probe, promote: false,
        _testAfterFinalIdentityCheck() {
          fs.writeFileSync(mutableFixture,
            "#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.writeFileSync(process.argv[2], 'replacement executed\\n');\n");
        },
      });
    } finally {
      fs.writeFileSync(mutableFixture, mutableOriginal);
    }
    assert.equal(sealedExecution.outcome, 'success', JSON.stringify(sealedExecution.error));
    assert.equal(fs.readFileSync(sealedMarker, 'utf8'), 'payload executed\n',
      'post-check replacement must execute the already frozen entrypoint bytes');
    assert.match(sealedExecution.preflight.execution_snapshot.digest, /^[a-f0-9]{64}$/);

    const failure = await runSafely({
      command: [process.execPath, fixture, 'failure'],
      tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, 'failure.json'),
      overrides: limits, probe, promote: false,
    });
    assert.equal(failure.outcome, 'command_failed');
    assert.equal(failure.termination.child_exit_code, 7);
    assert.equal(validateReport(failure).valid, true);

    const outputFlood = await runSafely({
      command: [process.execPath, fixture, 'output-flood'],
      tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, 'output-flood.json'),
      overrides: { ...limits, outputMaxBytes: 64 * 1024 }, probe, promote: false,
    });
    assert.equal(outputFlood.outcome, 'safety_limit_exceeded');
    assert.equal(outputFlood.termination.limit, 'output');
    assert.ok(outputFlood.output.total_bytes > outputFlood.limits.output_max_bytes);
    assert.equal(outputFlood.output.truncated, true);
    assert.deepEqual(outputFlood.cleanup.descendants_remaining, []);
    assert.equal(outputFlood.cleanup.scope_removed, true);
    assert.equal(outputFlood.cleanup.errors.length, 0);
    assert.equal(validateReport(outputFlood).valid, true);

    const graphRepository = path.join(workspaceScratch, `graph-repository-${'x'.repeat(80)}`);
    fs.mkdirSync(graphRepository);
    const initialized = spawnSync('git', ['init', '--quiet'], {
      cwd: graphRepository,
      encoding: 'utf8',
    });
    assert.equal(initialized.status, 0, initialized.stderr);
    for (const boundary of [
      'graphd_reserved', 'graphd_spawned', 'graphd_bound', 'graphd_authorized',
      'graphd_lock_created', 'graphd_objects_ready', 'graphd_sealed',
    ]) {
      const crashRepository = path.join(workspaceScratch, `${boundary}-${'y'.repeat(72)}`);
      fs.mkdirSync(crashRepository);
      assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: crashRepository }).status, 0);
      const graphdCrash = await runSupervisorCrashSelfTest({
        cwd: workloadCwd, reportDirectory: reports, boundary, graphRepository: crashRepository,
      });
      assert.equal(graphdCrash.passed, true, JSON.stringify(graphdCrash, null, 2));
      const crashPaths = runtimePaths(crashRepository);
      assert.equal(fs.existsSync(crashPaths.socket), false, `${boundary} socket must be absent`);
      assert.equal(fs.existsSync(crashPaths.lock), false, `${boundary} lock must be absent`);
    }
    const managedGraphd = await runSafely({
      command: [process.execPath, graphdFixture, graphRepository],
      tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, 'managed-graphd.json'),
      overrides: {
        ...limits,
        pidsMax: 64,
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
    assert.ok(Buffer.byteLength(graphdOutput.socket) >= 108,
      'managed graphd fixture must exercise production long-socket handling');
    const registration = JSON.parse(graphdOutput.registration);
    assert.equal(registration.namespace_pid, graphdOutput.pid);
    assert.ok(registration.pid > registration.namespace_pid,
      'broker evidence must retain the canonical host PID and the payload namespace PID');
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
      tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, 'stale-graphd.json'),
      overrides: { ...limits, pidsMax: 64, timeoutMs: 5_000, gracefulStopMs: 500 },
      probe, promote: false,
    });
    assert.equal(staleGraphd.outcome, 'internal_error');
    assert.equal(staleGraphd.termination.reason, 'cleanup_incomplete');
    assert.deepEqual(staleGraphd.cleanup.managed_paths_remaining, [runtimePaths(graphRepository).socket],
      'exact sealed lock may be removed, but a foreign socket replacement must remain');
    assert.equal(fs.existsSync(graphData), true, 'cleanup must not delete canonical graph data');
    assert.equal(validateReport(staleGraphd).valid, true);
    for (const managedPath of staleGraphd.cleanup.managed_paths_remaining) {
      fs.rmSync(managedPath, { force: true });
    }

    const earlyGraphd = await runSafely({
      command: [process.execPath, graphdFixture, graphRepository, 'exit-stale'],
      tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, 'early-graphd.json'),
      overrides: { ...limits, pidsMax: 64, timeoutMs: 5_000, gracefulStopMs: 500 },
      promote: false,
    });
    assert.equal(earlyGraphd.outcome, 'internal_error');
    assert.equal(earlyGraphd.termination.reason, 'cleanup_incomplete');
    assert.deepEqual(earlyGraphd.cleanup.managed_paths_remaining, [runtimePaths(graphRepository).socket],
      'early foreign socket replacement must remain while the exact sealed lock is removed');
    assert.equal(fs.existsSync(graphData), true, 'cleanup must preserve canonical graph data');
    for (const managedPath of earlyGraphd.cleanup.managed_paths_remaining) {
      fs.rmSync(managedPath, { force: true });
    }

    const retryCommand = [
      process.execPath, graphdFixture, graphRepository, 'leave-stale', 'hold',
    ];
    const cleanupAfterLimit = await runSafely({
      command: retryCommand,
      tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, 'limit-cleanup-failure.json'),
      overrides: { ...limits, pidsMax: 64, timeoutMs: 300, gracefulStopMs: 100 },
      promote: false,
    });
    assert.ok(['safety_limit_exceeded', 'internal_error'].includes(cleanupAfterLimit.outcome));
    assert.ok(['safety_limit_exceeded', 'cleanup_incomplete'].includes(
      cleanupAfterLimit.termination.reason));
    assert.equal(checkSafetyRetry(workloadCwd, retryCommand, cleanupAfterLimit.limits).ok, false,
      'an observed safety limit must survive cleanup outcome normalization');
    for (const managedPath of cleanupAfterLimit.cleanup.managed_paths_remaining) {
      fs.rmSync(managedPath, { force: true });
    }

    for (const [mode, expectedLimit] of [
      ['temp-deleted-open', 'temporary_disk'],
      ['temp-inode-storm', 'temporary_inodes'],
      ['temp-symlink', 'temporary_symlink'],
    ]) {
      const temporary = await runSafely({
        command: [process.execPath, fixture, mode],
        tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, `${mode}.json`),
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
    tier: 'small', cwd: workloadCwd, reportFile: path.join(reports, 'detached.json'),
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
  cleanupWorkspaceScratch();
  process.off('exit', cleanupWorkspaceScratch);
  if (completed && !process.env.LAMINA_SAFE_RUNNER_TEST_ARTIFACT_DIR) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  else process.stderr.write(`safe-runner integration evidence preserved at ${root}\n`);
}

console.log('safe_runner_integration_test: ok');
